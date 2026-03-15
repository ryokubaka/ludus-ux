/**
 * POST /api/goad/instances/set-range
 *
 * Writes a rangeId to the .goad_range_id tracking file for one or more GOAD
 * instance workspaces.  Called after a new-instance deploy completes to link
 * the newly created instance(s) with the pre-created dedicated Ludus range.
 *
 * Body: { rangeId: string; instanceIds: string[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { writeGoadRangeId, type SSHCreds } from "@/lib/goad-ssh"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { rangeId?: string; instanceIds?: string[] }
  try { body = await request.json() } catch { body = {} }

  const { rangeId, instanceIds } = body
  if (!rangeId || !Array.isArray(instanceIds) || instanceIds.length === 0) {
    return NextResponse.json({ error: "rangeId and instanceIds are required" }, { status: 400 })
  }

  const settings = getSettings()
  const rootCreds: SSHCreds | undefined = settings.proxmoxSshPassword
    ? { username: settings.proxmoxSshUser || "root", password: settings.proxmoxSshPassword }
    : undefined

  const results: { instanceId: string; ok: boolean; error?: string }[] = []

  for (const instanceId of instanceIds) {
    // Write to local DB first — reliable, no SSH dependency.
    // This ensures the instances API returns the correct ludusRangeId even when
    // root SSH credentials are not configured (SSH write is best-effort only).
    setInstanceRangeLocal(instanceId, rangeId)

    // Best-effort SSH write to the .goad_range_id file on the remote server.
    // This keeps the on-server record in sync for any tooling that reads it directly.
    try {
      await writeGoadRangeId(instanceId, rangeId, rootCreds)
      results.push({ instanceId, ok: true })
    } catch (err) {
      // SSH write failed — local DB is already updated so the UI will still show
      // the correct association.
      results.push({ instanceId, ok: true, error: (err as Error).message })
    }
  }

  const allOk = results.every((r) => r.ok)
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 })
}
