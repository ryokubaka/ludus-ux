import type { NextRequest } from "next/server"
import { cookieImpersonation } from "@/lib/admin/admin-impersonation-request"
import { scheduleGoadDeployLinkage } from "@/lib/goad/goad-deploy-link"
import { goadLogShowsFailure } from "@/lib/goad/goad-task-outcome"
import {
  isGoadConfigured,
  listGoadInstances,
  sshExecAsWorkspaceUser,
  streamGoadCommand,
} from "@/lib/goad/goad-ssh"
import { appendLine, completeTask, createTask, getTask } from "@/lib/goad/goad-task-store"
import { assertRouterTemplateReady } from "@/lib/ludus/ludus-router-template-assert"
import { routerTemplateBlockMessage } from "@/lib/ludus/ludus-router-template"
import { deregisterCleanup, registerCleanup } from "@/lib/core/task-cleanup-registry"
import { liveSessionIsAdmin } from "@/lib/session/session-admin-check"
import type { ResolvedSession } from "@/lib/session/session"

/**
 * Start the same GOAD install the new-instance wizard starts, and return its task id.
 * The command keeps running after this function returns. Lines stay on the GOAD task.
 */
export async function launchGoadInstall(opts: {
  request: NextRequest
  session: ResolvedSession
  apiKey: string
  rangeId: string
  args: string
  /** Network section restored after GOAD rewrites the range config. */
  networkRulesJson?: string
}): Promise<string> {
  if (!isGoadConfigured()) {
    throw new Error("GOAD is not configured on this server.")
  }
  const isAdmin = await liveSessionIsAdmin(opts.session)
  const impersonation = cookieImpersonation(opts.session)
  const sshUser = (impersonation.sshLogin || impersonation.ludusPrincipal || "").trim()
  const asUser = isAdmin && impersonation.apiKey && sshUser
    ? { username: sshUser, apiKey: impersonation.apiKey }
    : null
  if (!asUser && !opts.session.sshPassword?.trim()) {
    throw new Error("Log in with your SSH password before deploying GOAD.")
  }
  const apiKey = asUser?.apiKey || opts.apiKey
  const router = await assertRouterTemplateReady(apiKey)
  if (!router.ok) throw new Error(routerTemplateBlockMessage(router))

  const owner = asUser?.username || opts.session.username
  const creds = !asUser && opts.session.sshPassword
    ? { username: opts.session.username, password: opts.session.sshPassword }
    : undefined
  const runAsOwner = (command: string) =>
    sshExecAsWorkspaceUser(opts.request, opts.session, command, creds)

  const taskId = createTask(opts.args, undefined, owner, apiKey)
  let beforeInstanceIds: string[] = []
  try {
    beforeInstanceIds = (await listGoadInstances()).map((instance) => instance.instanceId)
  } catch {
    beforeInstanceIds = []
  }
  scheduleGoadDeployLinkage({
    taskId,
    rangeId: opts.rangeId,
    username: owner,
    apiKey,
    beforeInstanceIds,
    runAsOwner,
    networkRulesJson: opts.networkRulesJson,
  })

  void streamGoadCommand(
    opts.args,
    apiKey,
    (line) => { appendLine(taskId, line) },
    (code) => {
      deregisterCleanup(taskId)
      const logText = (getTask(taskId)?.lines ?? []).join("\n")
      const failed = goadLogShowsFailure(logText)
      const current = getTask(taskId)?.status
      if (failed) completeTask(taskId, code === 0 ? 1 : code, "error")
      else if (current === "running") completeTask(taskId, code, code === 0 ? "completed" : "error")
      appendLine(taskId, `[EXIT] Command exited with code ${failed && code === 0 ? 1 : code}`)
    },
    (err) => {
      deregisterCleanup(taskId)
      completeTask(taskId, -1, "error")
      appendLine(taskId, `[ERROR] ${err.message}`)
    },
    creds,
    asUser ?? undefined,
    owner,
    opts.rangeId,
    undefined,
    undefined,
    undefined,
    isAdmin,
  ).then((cleanup) => {
    registerCleanup(taskId, cleanup)
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "GOAD deploy failed to start."
    completeTask(taskId, -1, "error")
    appendLine(taskId, `[ERROR] ${message}`)
  })

  return taskId
}
