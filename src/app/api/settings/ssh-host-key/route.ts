/**
 * GET    /api/settings/ssh-host-key — stored SSH host key fingerprints (admin)
 * DELETE /api/settings/ssh-host-key — forget one { host, port } so the next connection pins again (admin)
 *
 * Forgetting re-opens trust-on-first-use for that host, so it is admin-only and
 * audited. LUX_SSH_HOST_KEY, when set, still decides every connection.
 */

import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"
import { parseJsonBody } from "@/lib/session/require-session"
import { forgetSshHostKey, listStoredSshHostKeys } from "@/lib/ssh/ssh-host-key"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const pinned = Boolean(process.env.LUX_SSH_HOST_KEY?.trim())
  return finishAdminResponse(NextResponse.json({ pinned, keys: listStoredSshHostKeys() }), admin)
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  const body = await parseJsonBody<{ host?: unknown; port?: unknown }>(request)
  const host = typeof body.host === "string" ? body.host.trim() : ""
  const port = typeof body.port === "number" ? body.port : Number(body.port ?? 22)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "host and a valid port are required" }, { status: 400 })
  }

  const removed = forgetSshHostKey(host, port)
  logLuxRouteAction(request, admin.session, {
    outcome: removed ? "success" : "failure",
    detail: `forget ssh host key ${host}:${port}`,
  })
  return finishAdminResponse(NextResponse.json({ ok: true, removed }), admin)
}
