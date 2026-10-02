/**
 * POST /api/goad/instances/reassign
 *
 * Reassigns a GOAD instance (and optionally its associated Ludus range) from
 * one user to another.  Admin-only.
 *
 * Steps performed:
 *  1. chown -R <targetUser> on the GOAD workspace directory (changes file ownership)
 *  2. Write the new rangeId to the .goad_range_id tracking file as that owner
 *  3. Update the local SQLite range store only after that write succeeds
 *  4. Transfer Ludus range ownership in PocketBase (sets ranges.userID to targetUserId)
 *
 * Note: We update PocketBase directly rather than using the Ludus /ranges/assign
 * endpoint, which is for *sharing* a range (granting read access) — not transferring
 * ownership.  Using /ranges/assign would leave the range owned by the original user
 * and cause it to appear for both users simultaneously.
 *
 * Body: { instanceId: string; targetUserId: string; rangeId?: string }
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { parseJsonBody } from "@/lib/require-session"
import { shouldDeferHostWorkspaceChown } from "@/lib/goad-deploy-link"
import { buildWorkspaceSshExecPlan, chownGoadInstance, listGoadInstances, runWorkspaceSshPlan, writeGoadRangeId } from "@/lib/goad-ssh"
import { getRunningTasksForInstance } from "@/lib/goad-task-store"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { setPbRangeOwner } from "@/lib/pocketbase-client"
import { bustAdminCache } from "@/lib/admin-data"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { effectivePrivilegedSshUser } from "@/lib/root-ssh-preflight"
import { getSettings } from "@/lib/settings-store"


export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const body = await parseJsonBody<{ instanceId?: string; targetUserId?: string; rangeId?: string }>(request)

  const { instanceId, targetUserId, rangeId } = body
  if (!instanceId || !targetUserId) {
    return NextResponse.json({ error: "instanceId and targetUserId are required" }, { status: 400 })
  }

  const errors: string[] = []
  const settings = getSettings()
  let directoryOwner = ""
  try {
    const listed = await listGoadInstances()
    directoryOwner = listed.find((item) => item.instanceId === instanceId)?.ownerUserId?.trim() ?? ""
  } catch {
    directoryOwner = ""
  }
  if (
    shouldDeferHostWorkspaceChown({
      directoryOwner,
      targetUser: targetUserId,
      hostUser: effectivePrivilegedSshUser(settings.proxmoxSshUser),
      hostProcessActive: getRunningTasksForInstance(instanceId).length > 0,
    })
  ) {
    return NextResponse.json(
      { ok: false, errors: ["GOAD is still writing this workspace"] },
      { status: 409 },
    )
  }

  // Step 1: Change OS-level file ownership of the GOAD workspace directory.
  // Elevated through lux-host / root — the host SSH account is not root.
  let chownOk = true
  try {
    await chownGoadInstance(instanceId, targetUserId)
  } catch (err) {
    chownOk = false
    errors.push(`chown failed: ${(err as Error).message}`)
  }

  // Steps 2–4: Update range association if provided
  if (rangeId) {
    if (chownOk) {
      try {
        await writeGoadRangeId(instanceId, rangeId, async (command) => {
          const plan = buildWorkspaceSshExecPlan({
            owner: targetUserId,
            innerCommand: command,
            privilegedSshConfigured: isRootProxmoxSshConfigured(settings),
            callerIsAdmin: true,
            hostSshUser: effectivePrivilegedSshUser(settings.proxmoxSshUser),
          })
          if (!plan.ok) throw new Error(plan.error)
          return runWorkspaceSshPlan(plan)
        })
        setInstanceRangeLocal(instanceId, rangeId)
      } catch (err) {
        errors.push(`range file write failed: ${(err as Error).message}`)
      }
    }

    // Step 4: Transfer range ownership in PocketBase.
    // This updates ranges.userID so the range shows under the new owner in
    // Ranges Overview and in the per-user range list.
    const pbErr = await setPbRangeOwner(rangeId, targetUserId)
    if (pbErr) {
      errors.push(`Range ownership transfer failed: ${pbErr}. Ensure LUDUS_ROOT_API_KEY is set.`)
    }

    // Bust server-side admin data cache so Ranges Overview reflects the change
    bustAdminCache()
  }

  if (errors.length > 0) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: errors[0]?.slice(0, 120) })
    return NextResponse.json({ ok: false, errors }, { status: 207 })
  }

  logLuxRouteAction(request, session, { detail: `instanceId=${instanceId} targetUserId=${targetUserId}` })
  return NextResponse.json({ ok: true })
}
