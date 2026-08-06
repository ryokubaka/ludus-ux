import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { startSoSniffWatcher } from "@/lib/so-sniff-workflow"

/**
 * POST /api/so-sniff/watch
 * Body: { rangeId: string, sniffTag?: number }
 * Starts a background Proxmox sniff-NIC watcher for an SO range deploy.
 */
export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { rangeId?: string; sniffTag?: number } = {}
  try {
    body = (await request.json()) as { rangeId?: string; sniffTag?: number }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rangeId = body.rangeId?.trim()
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId required" }, { status: 400 })
  }

  const imp = resolveAdminImpersonationFromRequest(session, request)
  const apiKey = imp.apiKey || session.apiKey
  if (!apiKey) {
    return NextResponse.json({ error: "No Ludus API key in session" }, { status: 400 })
  }

  startSoSniffWatcher({
    rangeId,
    apiKey,
    sniffTag: typeof body.sniffTag === "number" ? body.sniffTag : undefined,
  })

  return NextResponse.json({ ok: true, rangeId })
}
