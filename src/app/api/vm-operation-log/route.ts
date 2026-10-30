import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { requireAdmin } from "@/lib/session/require-admin"
import { insertVmOperation, listVmOperations } from "@/lib/logs/vm-operation-log"
import { effectiveImpersonatedOperatorUsername } from "@/lib/admin/admin-impersonation-request"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"


/**
 * GET /api/vm-operation-log?rangeId=…&instanceId=…&limit=…
 *
 * Non-admin sessions always filter to their own rows (impersonation-aware); admin
 * sessions can request `?username=<name>` to scope to a specific user, and omit it
 * to see everyone. Rows are newest-first.
 */
export async function GET(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  let session = gate.session
  if (session.isAdmin) {
    const admin = await requireAdmin(request)
    if (!admin.ok) session = { ...session, isAdmin: false }
    else session = admin.session
  }

  const effectiveOp = await effectiveImpersonatedOperatorUsername(session, request)

  const url = new URL(request.url)
  const rangeId = url.searchParams.get("rangeId")?.trim() || null
  const instanceId = url.searchParams.get("instanceId")?.trim() || null
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined

  // Non-admins see only their own rows (impersonation already rewrote username
  // on insert). Admins default to "everyone" unless they pass ?username=.
  let usernameFilter: string | null = null
  if (!session.isAdmin) {
    usernameFilter = effectiveOp
  } else {
    const qUser = url.searchParams.get("username")?.trim()
    if (qUser) usernameFilter = qUser
  }

  try {
    const entries = listVmOperations({
      rangeId,
      instanceId,
      username: usernameFilter,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
    return NextResponse.json({ entries })
  } catch (err) {
    return NextResponse.json(
      { error: `List failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}

/**
 * POST /api/vm-operation-log
 * Append one row to the local SQLite audit table (VM destroy / extension removal).
 */
export async function POST(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  let session = gate.session
  if (session.isAdmin) {
    const admin = await requireAdmin(request)
    if (!admin.ok) session = { ...session, isAdmin: false }
    else session = admin.session
  }

  const username = await effectiveImpersonatedOperatorUsername(session, request)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const kind = typeof body.kind === "string" ? body.kind.trim() : ""
  if (kind !== "destroy_vm" && kind !== "remove_extension") {
    return NextResponse.json({ error: "kind must be destroy_vm or remove_extension" }, { status: 400 })
  }

  const status = body.status === "error" ? "error" : "ok"

  let vmId: number | null = null
  if (typeof body.vmId === "number" && !Number.isNaN(body.vmId)) vmId = body.vmId
  else if (typeof body.vmId === "string" && body.vmId.trim()) {
    const n = parseInt(body.vmId, 10)
    vmId = Number.isNaN(n) ? null : n
  }

  try {
    insertVmOperation({
      username,
      kind: kind as "destroy_vm" | "remove_extension",
      rangeId: typeof body.rangeId === "string" ? body.rangeId : null,
      instanceId: typeof body.instanceId === "string" ? body.instanceId : null,
      vmId,
      vmName: typeof body.vmName === "string" ? body.vmName : null,
      extensionName: typeof body.extensionName === "string" ? body.extensionName : null,
      status,
      detail: typeof body.detail === "string" ? body.detail : null,
    })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Log write failed" })
    return NextResponse.json(
      { error: `Log write failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }

  logLuxRouteAction(request, session, { detail: `${kind} vmId=${vmId ?? "?"}` })
  return NextResponse.json({ ok: true })
}
