/**
 * POST /api/goad/instances/[instanceId]/force-delete
 *
 * Force-deletes a GOAD instance when the normal destroy flow fails:
 *   1. Calls DELETE /range?rangeID=xxx&force=true via the Ludus API
 *   2. Removes the GOAD workspace directory via SSH
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { sshExec, type SSHCreds } from "@/lib/goad-ssh"

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
  const { ludusRangeId } = body as { ludusRangeId?: string }

  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const results: { rangeDeleted: boolean; workspaceRemoved: boolean; errors: string[] } = {
    rangeDeleted: false,
    workspaceRemoved: false,
    errors: [],
  }

  // Step 1: Delete the Ludus range (force=true destroys VMs)
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
  }

  // Step 2: Remove the GOAD workspace directory
  try {
    const creds: SSHCreds | undefined = session.sshPassword
      ? { username: session.username, password: session.sshPassword }
      : undefined

    const { getSettings } = await import("@/lib/settings-store")
    const goadPath = getSettings().goadPath || "/opt/goad-mod"
    const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "")
    const workspacePath = `${goadPath}/workspace/${safeId}`

    const { code } = await sshExec(`rm -rf '${workspacePath}'`, creds)
    results.workspaceRemoved = code === 0
    if (!results.workspaceRemoved) {
      results.errors.push(`Workspace removal exited with code ${code}`)
    }
  } catch (err) {
    results.errors.push(`Workspace removal failed: ${(err as Error).message}`)
  }

  return NextResponse.json(results)
}
