/**
 * POST /api/goad/instances/reassign
 *
 * Reassigns a GOAD instance (and optionally its associated Ludus range) from
 * one user to another.  Admin-only.
 *
 * Steps performed:
 *  1. chown -R <targetUser> on the GOAD workspace directory (changes file ownership)
 *  2. Update the local SQLite range store with the new rangeId (if provided)
 *  3. Write the new rangeId to the .goad_range_id tracking file on the server
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
import { getSettings } from "@/lib/settings-store"
import { chownGoadInstance, writeGoadRangeId, type SSHCreds } from "@/lib/goad-ssh"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { setPbRangeOwner } from "@/lib/pocketbase-client"
import { bustAdminCache } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let body: { instanceId?: string; targetUserId?: string; rangeId?: string }
  try { body = await request.json() } catch { body = {} }

  const { instanceId, targetUserId, rangeId } = body
  if (!instanceId || !targetUserId) {
    return NextResponse.json({ error: "instanceId and targetUserId are required" }, { status: 400 })
  }

  const settings = getSettings()
  const rootCreds: SSHCreds | undefined = settings.proxmoxSshPassword
    ? { username: settings.proxmoxSshUser || "root", password: settings.proxmoxSshPassword }
    : undefined

  const errors: string[] = []

  // Step 1: Change OS-level file ownership of the GOAD workspace directory.
  // This updates the ownerUserId that listGoadInstances reads from the filesystem.
  try {
    await chownGoadInstance(instanceId, targetUserId, rootCreds)
  } catch (err) {
    errors.push(`chown failed: ${(err as Error).message}`)
  }

  // Steps 2–4: Update range association if provided
  if (rangeId) {
    // Step 2: Update local SQLite tracking DB (highest priority source for enrichment)
    setInstanceRangeLocal(instanceId, rangeId)

    // Step 3: Write .goad_range_id tracking file on the server (best-effort)
    try {
      await writeGoadRangeId(instanceId, rangeId, rootCreds)
    } catch {
      // SSH write is best-effort; local DB already updated above
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
    return NextResponse.json({ ok: false, errors }, { status: 207 })
  }

  return NextResponse.json({ ok: true })
}
