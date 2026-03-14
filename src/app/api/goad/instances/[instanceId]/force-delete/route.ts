/**
 * POST /api/goad/instances/[instanceId]/force-delete
 *
 * Force-deletes a GOAD instance when the normal destroy flow fails:
 *   1. Deletes the instance's dedicated Ludus range (rangeID-scoped, force=true)
 *   2. Removes the GOAD workspace directory via SSH
 *
 * The rangeID can be provided in the request body. If omitted, we try to read
 * it from the .goad_range_id file in the instance workspace.  When no rangeID
 * is available the range deletion step is skipped (the caller must clean it up
 * manually via the Ranges Overview page).
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { sshExec, readGoadRangeId, type SSHCreds } from "@/lib/goad-ssh"
import { getSettings } from "@/lib/settings-store"

export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = params
  const body = await request.json().catch(() => ({}))
  const { ludusRangeId: bodyRangeId } = body as { ludusRangeId?: string }

  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const results: { rangeDeleted: boolean; workspaceRemoved: boolean; errors: string[] } = {
    rangeDeleted: false,
    workspaceRemoved: false,
    errors: [],
  }

  const settings = getSettings()
  const rootCreds: SSHCreds | undefined = settings.proxmoxSshPassword
    ? { username: settings.proxmoxSshUser || "root", password: settings.proxmoxSshPassword }
    : undefined

  // Resolve rangeID: prefer explicit body value, fall back to workspace file
  let ludusRangeId = bodyRangeId || null
  if (!ludusRangeId) {
    try {
      ludusRangeId = await readGoadRangeId(instanceId, rootCreds)
    } catch {
      results.errors.push("Could not read .goad_range_id from workspace — range deletion skipped")
    }
  }

  // Step 1: Delete the dedicated Ludus range (force=true destroys its VMs)
  if (ludusRangeId) {
    try {
      const res = await ludusRequest(
        `/range?rangeID=${encodeURIComponent(ludusRangeId)}&force=true`,
        { method: "DELETE", apiKey: effectiveApiKey }
      )
      results.rangeDeleted = res.status >= 200 && res.status < 300
      if (!results.rangeDeleted) {
        results.errors.push(`Ludus range delete returned ${res.status}`)
      }
    } catch (err) {
      results.errors.push(`Range delete failed: ${(err as Error).message}`)
    }
  } else {
    results.errors.push("No rangeID available — Ludus range was NOT deleted. Remove it manually via the Ranges page.")
  }

  // Step 2: Remove the GOAD workspace directory
  try {
    const goadPath = settings.goadPath || "/opt/goad-mod"
    const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "")
    const workspacePath = `${goadPath}/workspace/${safeId}`

    const { code } = await sshExec(`rm -rf '${workspacePath}'`, rootCreds)
    results.workspaceRemoved = code === 0
    if (!results.workspaceRemoved) {
      results.errors.push(`Workspace removal exited with code ${code}`)
    }
  } catch (err) {
    results.errors.push(`Workspace removal failed: ${(err as Error).message}`)
  }

  return NextResponse.json(results)
}
