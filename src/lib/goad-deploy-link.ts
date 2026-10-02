/**
 * Server-side GOAD deploy linkage — range ↔ instance mapping + ownership.
 *
 * The /goad/new UI does this client-side (handoff → poll → set-range).
 * Assistant /api/goad/execute skips that UI, so without this the dashboard
 * "GOAD Instance" button never appears and workspaces stay host-owned.
 */

import { createDeployHandoff, linkHandoffToTask } from "@/lib/goad-deploy-handoff-store"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { chownGoadInstance, listGoadInstances, writeGoadRangeId } from "@/lib/goad-ssh"
import { getRunningTasksForInstance, getTask, listTasks, updateTaskInstance } from "@/lib/goad-task-store"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { effectivePrivilegedSshUser } from "@/lib/root-ssh-preflight"
import { getSettings } from "@/lib/settings-store"
import { setOwnership } from "@/lib/range-ownership-store"
import { ludusRequest } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"

const POLL_MS = 3_000
const POLL_MAX_MS = 5 * 60 * 1000

function sameLinuxUser(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  return left.length > 0 && left === right
}

function isResolvedOwnerName(owner: string): boolean {
  const name = owner.trim()
  return name.length > 0 && !/^\d+$/.test(name)
}

type WorkspaceOwnerGate = "allow" | "foreign" | "unresolved"

function workspaceOwnerGate(directoryOwner: string, targetUser: string, hostUser: string): WorkspaceOwnerGate {
  if (!isResolvedOwnerName(directoryOwner)) return "unresolved"
  if (sameLinuxUser(directoryOwner, hostUser) || sameLinuxUser(directoryOwner, targetUser)) return "allow"
  return "foreign"
}

export function goadCommandRunsAsHostAccount(opts: {
  sshPassword?: string | null
  impersonating: boolean
}): boolean {
  if (opts.impersonating) return false
  return !opts.sshPassword?.trim()
}

export function shouldDeferHostWorkspaceChown(opts: {
  directoryOwner: string
  targetUser: string
  hostUser: string
  hostProcessActive: boolean
}): boolean {
  if (!opts.hostProcessActive) return false
  if (sameLinuxUser(opts.targetUser, opts.hostUser)) return false
  if (!isResolvedOwnerName(opts.directoryOwner)) return true
  return sameLinuxUser(opts.directoryOwner, opts.hostUser)
}

export function setRangeHostProcessActive(instanceId: string): boolean {
  if (getRunningTasksForInstance(instanceId).length > 0) return true
  return listTasks().some((task) => task.status === "running" && !task.instanceId?.trim())
}

function hostGoadProcessActive(taskId: string, instanceId: string): boolean {
  if (getTask(taskId)?.status === "running") return true
  return getRunningTasksForInstance(instanceId).length > 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitWhileHostGoadWrites(taskId: string, instanceId: string): Promise<void> {
  while (hostGoadProcessActive(taskId, instanceId)) {
    await sleep(POLL_MS)
  }
}

export type GoadOwnerExec = (
  command: string,
) => Promise<{ stdout: string; stderr: string; code: number }>

export type GoadDeployLinkageOpts = {
  taskId: string
  rangeId: string
  /** Linux / GOAD workspace owner (session or impersonated user). */
  username: string
  /** Optional Ludus API key to resolve PocketBase userID for range_ownership. */
  apiKey?: string | null
  /** When redeploying an existing instance. */
  instanceId?: string
  /** Snapshot of instance ids before execute started. */
  beforeInstanceIds?: Iterable<string>
  runAsOwner: GoadOwnerExec
}

export type GoadDeployLinkageResult =
  | { ok: true }
  | { ok: false; error: string; skip?: boolean; pending?: boolean; awaitingProcess?: boolean }

/** Pure helper — pick the new instance from a list (exported for tests). */
export function pickNewGoadInstanceId(
  instances: Array<{ instanceId: string; ludusRangeId?: string }>,
  opts: { rangeId: string; beforeIds: Set<string> },
): string | null {
  const byRange = instances.find(
    (i) => i.ludusRangeId && i.ludusRangeId === opts.rangeId && !opts.beforeIds.has(i.instanceId),
  )
  if (byRange) return byRange.instanceId
  const neu = instances.find((i) => !opts.beforeIds.has(i.instanceId))
  return neu?.instanceId ?? null
}

export async function finalizeGoadDeployLinkage(opts: {
  taskId: string
  rangeId: string
  instanceId: string
  username: string
  apiKey?: string | null
  runAsOwner: GoadOwnerExec
  /** Linux owner of the workspace directory (from the host account's instance list). */
  directoryOwner: string
  hostProcessActive?: boolean
}): Promise<GoadDeployLinkageResult> {
  const { taskId, rangeId, instanceId, username, apiKey, runAsOwner, directoryOwner } = opts
  const settings = getSettings()
  const rootCreds = rootPasswordCredsIfSet(settings)
  const ownerLinux = username.trim()
  const hostUser = effectivePrivilegedSshUser(settings.proxmoxSshUser)
  const gate = workspaceOwnerGate(directoryOwner, ownerLinux, hostUser)

  if (gate === "unresolved") {
    return { ok: false, error: "Workspace owner is unresolved", pending: true }
  }
  if (gate === "foreign") {
    return { ok: false, error: `Workspace is owned by ${directoryOwner.trim()}`, skip: true }
  }
  if (
    shouldDeferHostWorkspaceChown({
      directoryOwner,
      targetUser: ownerLinux,
      hostUser,
      hostProcessActive: opts.hostProcessActive === true,
    })
  ) {
    return {
      ok: false,
      error: "Host GOAD process is still writing the workspace",
      pending: true,
      awaitingProcess: true,
    }
  }

  if (ownerLinux && ownerLinux.toLowerCase() !== "root") {
    try {
      await chownGoadInstance(instanceId, ownerLinux, rootCreds)
    } catch (err) {
      const error = (err as Error).message
      console.warn("[goad-deploy-link] chownGoadInstance:", error)
      return { ok: false, error }
    }
  }

  try {
    await writeGoadRangeId(instanceId, rangeId, runAsOwner)
  } catch (err) {
    const error = (err as Error).message
    console.warn("[goad-deploy-link] writeGoadRangeId:", error)
    return { ok: false, error }
  }

  setInstanceRangeLocal(instanceId, rangeId)
  updateTaskInstance(taskId, instanceId)

  if (apiKey?.trim()) {
    try {
      const who = await ludusRequest<unknown>("/user", { apiKey: apiKey.trim() })
      const caller = ludusCallerFromGetUser(who.data, ownerLinux)
      if (caller?.userId) {
        setOwnership(rangeId, caller.userId, ownerLinux || "goad-deploy-link")
      }
    } catch (err) {
      console.warn("[goad-deploy-link] setOwnership:", (err as Error).message)
    }
  }

  return { ok: true }
}

/**
 * Register handoff + background poll (or immediate finalize when instanceId known).
 * Fire-and-forget from /api/goad/execute — never blocks the SSE stream.
 */
export function scheduleGoadDeployLinkage(opts: GoadDeployLinkageOpts): { handoffId: string } {
  const rangeId = opts.rangeId.trim()
  const username = opts.username.trim()
  const handoff = createDeployHandoff({
    rangeId,
    instanceId: opts.instanceId,
    username,
  })
  linkHandoffToTask(handoff.id, opts.taskId)

  if (opts.instanceId?.trim()) {
    const instanceId = opts.instanceId.trim()
    void (async () => {
      const rootCreds = rootPasswordCredsIfSet(getSettings())
      let deadline = Date.now() + POLL_MAX_MS
      try {
        while (true) {
          const listed = await listGoadInstances(rootCreds)
          const directoryOwner =
            listed.find((i) => i.instanceId === instanceId)?.ownerUserId?.trim() ?? ""
          const linked = await finalizeGoadDeployLinkage({
            taskId: opts.taskId,
            rangeId,
            instanceId,
            username,
            apiKey: opts.apiKey,
            runAsOwner: opts.runAsOwner,
            directoryOwner,
            hostProcessActive: hostGoadProcessActive(opts.taskId, instanceId),
          })
          if (linked.ok) return
          if (linked.awaitingProcess) {
            await waitWhileHostGoadWrites(opts.taskId, instanceId)
            deadline = Date.now() + POLL_MAX_MS
            continue
          }
          if (!linked.pending) {
            console.warn("[goad-deploy-link] finalize known instance:", linked.error)
            return
          }
          if (Date.now() >= deadline) break
          await sleep(POLL_MS)
        }
        console.warn(
          `[goad-deploy-link] timed out waiting for workspace owner (task=${opts.taskId} range=${rangeId} instance=${instanceId})`,
        )
      } catch (err) {
        console.error("[goad-deploy-link] finalize known instance:", err)
      }
    })()
    return { handoffId: handoff.id }
  }

  const beforeIds = new Set(
    [...(opts.beforeInstanceIds || [])].map((id) => id.trim()).filter(Boolean),
  )

  void (async () => {
    const settings = getSettings()
    const rootCreds = rootPasswordCredsIfSet(settings)
    let deadline = Date.now() + POLL_MAX_MS
    let heldId: string | null = null
    while (true) {
      if (!heldId && Date.now() >= deadline) break
      if (!heldId) await sleep(POLL_MS)
      try {
        const instances = await listGoadInstances(rootCreds)
        const newId = heldId ?? pickNewGoadInstanceId(instances, { rangeId, beforeIds })
        if (!newId) continue
        const directoryOwner =
          instances.find((i) => i.instanceId === newId)?.ownerUserId?.trim() ?? ""
        const linked = await finalizeGoadDeployLinkage({
          taskId: opts.taskId,
          rangeId,
          instanceId: newId,
          username,
          apiKey: opts.apiKey,
          runAsOwner: opts.runAsOwner,
          directoryOwner,
          hostProcessActive: hostGoadProcessActive(opts.taskId, newId),
        })
        if (linked.ok) return
        if (linked.awaitingProcess) {
          heldId = newId
          await waitWhileHostGoadWrites(opts.taskId, newId)
          deadline = Date.now() + POLL_MAX_MS
          continue
        }
        heldId = null
        if (linked.pending) continue
        if (linked.skip) {
          beforeIds.add(newId)
          continue
        }
        console.warn("[goad-deploy-link] finalize:", linked.error)
        return
      } catch (err) {
        console.warn("[goad-deploy-link] poll:", (err as Error).message)
        if (heldId) await sleep(POLL_MS)
      }
    }
    console.warn(
      `[goad-deploy-link] timed out waiting for GOAD instance (task=${opts.taskId} range=${rangeId})`,
    )
  })()

  return { handoffId: handoff.id }
}
