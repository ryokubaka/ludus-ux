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
    try {
      await writeGoadRangeId(instanceId, rangeId, rootCreds)
      results.push({ instanceId, ok: true })
    } catch (err) {
      results.push({ instanceId, ok: false, error: (err as Error).message })
    }
  }

  const allOk = results.every((r) => r.ok)
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 })
}
