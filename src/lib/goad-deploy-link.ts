/**
 * Server-side GOAD deploy linkage — range ↔ instance mapping + ownership.
 *
 * The /goad/new UI does this client-side (handoff → poll → set-range → chown).
 * Assistant /api/goad/execute skips that UI, so without this the dashboard
 * "GOAD Instance" button never appears and workspaces stay root-owned.
 */

import { createDeployHandoff, linkHandoffToTask } from "@/lib/goad-deploy-handoff-store"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { updateTaskInstance } from "@/lib/goad-task-store"
import { chownGoadInstance, listGoadInstances, writeGoadRangeId } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { getSettings } from "@/lib/settings-store"
import { setOwnership } from "@/lib/range-ownership-store"
import { ludusRequest } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"

const POLL_MS = 3_000
const POLL_MAX_MS = 5 * 60 * 1000

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
}

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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { taskId, rangeId, instanceId, username, apiKey } = opts
  const settings = getSettings()
  const rootCreds = rootPasswordCredsIfSet(settings)

  setInstanceRangeLocal(instanceId, rangeId)
  updateTaskInstance(taskId, instanceId)

  try {
    await writeGoadRangeId(instanceId, rangeId, rootCreds)
  } catch (err) {
    console.warn("[goad-deploy-link] writeGoadRangeId:", (err as Error).message)
  }

  const ownerLinux = username.trim()
  if (ownerLinux && ownerLinux.toLowerCase() !== "root") {
    try {
      await chownGoadInstance(instanceId, ownerLinux, rootCreds)
    } catch (err) {
      console.warn("[goad-deploy-link] chownGoadInstance:", (err as Error).message)
    }
  }

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
    void finalizeGoadDeployLinkage({
      taskId: opts.taskId,
      rangeId,
      instanceId: opts.instanceId.trim(),
      username,
      apiKey: opts.apiKey,
    }).catch((err) => console.error("[goad-deploy-link] finalize known instance:", err))
    return { handoffId: handoff.id }
  }

  const beforeIds = new Set(
    [...(opts.beforeInstanceIds || [])].map((id) => id.trim()).filter(Boolean),
  )

  void (async () => {
    const settings = getSettings()
    const rootCreds = rootPasswordCredsIfSet(settings)
    const deadline = Date.now() + POLL_MAX_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      try {
        const instances = await listGoadInstances(rootCreds)
        const newId = pickNewGoadInstanceId(instances, { rangeId, beforeIds })
        if (!newId) continue
        await finalizeGoadDeployLinkage({
          taskId: opts.taskId,
          rangeId,
          instanceId: newId,
          username,
          apiKey: opts.apiKey,
        })
        return
      } catch (err) {
        console.warn("[goad-deploy-link] poll:", (err as Error).message)
      }
    }
    console.warn(
      `[goad-deploy-link] timed out waiting for GOAD instance (task=${opts.taskId} range=${rangeId})`,
    )
  })()

  return { handoffId: handoff.id }
}
