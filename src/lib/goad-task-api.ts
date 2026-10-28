import { NextRequest, NextResponse } from "next/server"
import type { GoadTask } from "@/lib/goad-task-store"
import { effectiveImpersonatedOperatorUsername } from "@/lib/admin-impersonation-request"
import { liveSessionIsAdmin } from "@/lib/session-admin-check"
import type { ResolvedSession } from "@/lib/session"

/** Client-safe task shape — no secrets or log lines (list + correlation). */
export type PublicGoadTask = {
  id: string
  command: string
  instanceId?: string
  status: GoadTask["status"]
  startedAt: number
  endedAt?: number
  exitCode?: number
  lineCount: number
  phase?: "network-deploy" | null
  hasNetworkRules?: boolean
}

/** Task detail for history/resume — includes log lines; still no ludusApiKey. */
export type GoadTaskDetail = PublicGoadTask & {
  lines: string[]
}

export function toPublicGoadTask(task: GoadTask): PublicGoadTask {
  return {
    id: task.id,
    command: task.command,
    instanceId: task.instanceId,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    exitCode: task.exitCode,
    lineCount: task.lineCount,
    phase: task.phase ?? null,
    hasNetworkRules: task.hasNetworkRules ?? false,
  }
}

export function toGoadTaskDetail(task: GoadTask): GoadTaskDetail {
  return {
    ...toPublicGoadTask(task),
    lines: task.lines,
  }
}

/** An admin, or the operator who started the task. A task with no owner is open to its session's users. */
export async function canAccessGoadTask(
  session: ResolvedSession,
  request: NextRequest,
  task: Pick<GoadTask, "username">,
): Promise<boolean> {
  if (await liveSessionIsAdmin(session)) return true
  if (!task.username) return true
  return task.username === (await effectiveImpersonatedOperatorUsername(session, request))
}

/**
 * Enforce GOAD task ownership. Returns a 404 response when denied, null when allowed.
 */
export async function assertGoadTaskAccess(
  session: ResolvedSession,
  request: NextRequest,
  task: GoadTask,
): Promise<NextResponse | null> {
  if (!(await canAccessGoadTask(session, request, task))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return null
}
