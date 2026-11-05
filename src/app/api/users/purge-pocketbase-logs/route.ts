/**
 * POST /api/users/purge-pocketbase-logs
 * Body: { userId: string }
 *
 * Deletes PocketBase `logs` records that reference this Ludus user so
 * DELETE /user/{id} can succeed (deploy log history holds a required relation to users).
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/session/require-admin"
import { deletePbLogsForLudusUser } from "@/lib/core/pocketbase-client"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"


export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const session = admin.session

  const body = await request.json().catch(() => ({})) as { userId?: string }
  const userId = body.userId?.trim()
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const { deleted, error } = await deletePbLogsForLudusUser(userId)
  if (error) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: error })
    return NextResponse.json({ error, deleted }, { status: 502 })
  }
  logLuxRouteAction(request, session, { detail: `userId=${userId} deleted=${deleted}` })
  return NextResponse.json({ deleted })
}
