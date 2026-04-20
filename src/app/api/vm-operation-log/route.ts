import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { insertVmOperation, listVmOperations } from "@/lib/vm-operation-log"

export const dynamic = "force-dynamic"

/**
 * GET /api/vm-operation-log?rangeId=…&instanceId=…&limit=…
 *
 * Non-admin sessions always filter to their own rows (impersonation-aware); admin
 * sessions can request `?username=<name>` to scope to a specific user, and omit it
 * to see everyone. Rows are newest-first.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const impersonateAs =
    session.isAdmin && request.headers.get("X-Impersonate-As")
      ? request.headers.get("X-Impersonate-As")!.trim()
      : null

  const url = new URL(request.url)
  const rangeId = url.searchParams.get("rangeId")?.trim() || null
  const instanceId = url.searchParams.get("instanceId")?.trim() || null
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined

  // Non-admins see only their own rows (impersonation already rewrote username
  // on insert). Admins default to "everyone" unless they pass ?username=.
  let usernameFilter: string | null = null
  if (!session.isAdmin) {
    usernameFilter = impersonateAs || session.username
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
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const impersonateAs =
    session.isAdmin && request.headers.get("X-Impersonate-As")
      ? request.headers.get("X-Impersonate-As")!.trim()
      : null
  const username = impersonateAs || session.username

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
    return NextResponse.json(
      { error: `Log write failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
