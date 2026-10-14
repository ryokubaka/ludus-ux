/**
 * POST /api/goad/instances/[instanceId]/force-delete
 *
 * Force-deletes a GOAD instance when the normal destroy flow fails:
 *   1. Deletes the instance's dedicated Ludus range (rangeID-scoped, force=true)
 *   2. Removes the GOAD workspace directory via SSH
 *
 * The rangeID can be provided in the request body. If omitted, we try to read
 * it from the .goad_range_id file in the instance workspace. When no rangeID
 * is available the range deletion step is skipped (the caller must clean it up
 * manually via the Ranges Overview page).
 *
 * Body `skipRangeDeletion: true` removes only the GOAD workspace + SQLite link;
 * the Ludus range and VMs are left intact (used for "delete instance, keep range"
 * and for post–range-delete workspace cleanup).
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import {
  effectiveImpersonatedOperatorUsername,
  resolveAdminImpersonationFromRequest,
} from "@/lib/admin-impersonation-request"
import { ludusRequest } from "@/lib/ludus-client"
import { sshExec, sshExecAsWorkspaceUser, readGoadRangeId } from "@/lib/goad-ssh"
import { resolveGoadPath } from "@/lib/runtime-paths"
import { getDb } from "@/lib/db"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import type { RangeObject } from "@/lib/types"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { invalidateInProcessLudusCachesAfterMutation } from "@/lib/ludus-swr-invalidate"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GOAD `-t destroy` runs `ludus range rm`, which destroys VMs and keeps the range
 * record (`The range object will be kept in the database`). Wait out DESTROYING,
 * then DELETE the record. 404 means it is already gone.
 */
async function deleteLudusRangeRecord(
  apiKey: string,
  rangeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const deadline = Date.now() + 20 * 60 * 1000
  while (Date.now() < deadline) {
    const status = await ludusRequest<RangeObject>(
      `/range?rangeID=${encodeURIComponent(rangeId)}`,
      { apiKey, timeout: 45_000 },
    )
    if (status.status === 404) return { ok: true }
    const rs = String(status.data?.rangeState ?? "").trim().toUpperCase()
    if (rs !== "DESTROYING" && rs !== "DEPLOYING" && rs !== "WAITING") break
    await sleep(3_000)
  }

  let lastError = "Ludus range delete failed"
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await ludusRequest(
      `/range?rangeID=${encodeURIComponent(rangeId)}&force=true`,
      { method: "DELETE", apiKey, timeout: 120_000 },
    )
    if (res.status === 404 || (res.status >= 200 && res.status < 300)) return { ok: true }
    lastError = res.error || `Ludus range delete returned ${res.status}`
    await sleep(2_000)
  }
  return { ok: false, error: lastError }
}


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = await params

  // Non-admins may only delete instances that belong to their own username.
  // Instance IDs contain the username prefix (e.g. "alice-goad-mini-ludus"),
  // so this is a lightweight ownership guard; admins bypass it.
  if (!session.isAdmin) {
    const effectiveUser = effectiveImpersonatedOperatorUsername(session, request)
    if (!instanceId.toLowerCase().startsWith(effectiveUser.toLowerCase() + "-")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }
  const body = await request.json().catch(() => ({}))
  const { ludusRangeId: bodyRangeId, skipRangeDeletion } = body as {
    ludusRangeId?: string
    /** When true, only removes the workspace — does NOT delete the Ludus range.
     *  Used when re-deploying into an existing range (range is reused, not deleted). */
    skipRangeDeletion?: boolean
  }

  const { apiKey: impersonateApiKey } = resolveAdminImpersonationFromRequest(session, request)
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const results: { rangeDeleted: boolean; workspaceRemoved: boolean; errors: string[] } = {
    rangeDeleted: false,
    workspaceRemoved: false,
    errors: [],
  }

  const userCreds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined
  const runAsOwner = (command: string) =>
    sshExecAsWorkspaceUser(request, session, command, userCreds)

  // Resolve rangeID: prefer explicit body value, fall back to workspace file
  let ludusRangeId = bodyRangeId || null
  if (!ludusRangeId) {
    try {
      ludusRangeId = await readGoadRangeId(instanceId, undefined, runAsOwner)
    } catch {
      if (!skipRangeDeletion) {
        results.errors.push("Could not read .goad_range_id from workspace — range deletion skipped")
      }
    }
  }

  // Step 1: Delete the dedicated Ludus range (force=true destroys its VMs)
  // Skipped when skipRangeDeletion=true — instance-only delete or Ludus already removed the range.
  if (skipRangeDeletion) {
    results.rangeDeleted = false
  } else if (ludusRangeId) {
    try {
      const deleted = await deleteLudusRangeRecord(effectiveApiKey, ludusRangeId)
      results.rangeDeleted = deleted.ok
      if (deleted.ok) {
        const scopeTag = effectiveScopeTagFromSession(session)
        revalidateLudusResource("ranges")
        revalidateLudusScopeResource(scopeTag, "ranges")
        invalidateInProcessLudusCachesAfterMutation(effectiveApiKey)
      } else if (deleted.error) {
        results.errors.push(deleted.error)
      }
    } catch (err) {
      results.errors.push(`Range delete failed: ${(err as Error).message}`)
    }
  } else {
    results.errors.push("No rangeID available — Ludus range was NOT deleted. Remove it manually via the Ranges page.")
  }

  // Step 2: Remove the GOAD workspace directory. The list is the workspace
  // folder, so a failed rm leaves the range name on the GOAD page.
  if (!/^[A-Za-z0-9_-]+$/.test(instanceId)) {
    results.errors.push("Refusing to remove a workspace for this instance id")
  } else {
    try {
      const goadPath = resolveGoadPath()
      const workspacePath = `${goadPath}/workspace/${instanceId}`
      const ownerRm = await runAsOwner(`rm -rf '${workspacePath}'`)
      let code = ownerRm.code
      if (code !== 0) {
        try {
          const rootRm = await sshExec(`rm -rf '${workspacePath}'`)
          code = rootRm.code
        } catch {
          // A non-root host account cannot run an arbitrary rm. The owner attempt stands.
        }
      }
      results.workspaceRemoved = code === 0
      if (!results.workspaceRemoved) {
        results.errors.push(`Workspace removal exited with code ${code}`)
      }
    } catch (err) {
      results.errors.push(`Workspace removal failed: ${(err as Error).message}`)
    }
  }

  // Step 3: Drop the local link only after the folder is gone. A leftover
  // workspace is still found by the SSH listing.
  if (results.workspaceRemoved) {
    try {
      getDb()
        .prepare("DELETE FROM goad_instance_ranges WHERE instance_id = ?")
        .run(instanceId)
    } catch {
      // Non-fatal — the folder is already gone, so the list will not show it.
    }
  }

  logLuxRouteAction(request, session, {
    outcome: results.errors.length === 0 ? "success" : "failure",
    detail: `instanceId=${instanceId} rangeDeleted=${results.rangeDeleted}`,
  })
  return NextResponse.json(results)
}
