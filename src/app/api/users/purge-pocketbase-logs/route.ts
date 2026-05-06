/**
 * POST /api/users/purge-pocketbase-logs
 * Body: { userId: string }
 *
 * Deletes PocketBase `logs` records that reference this Ludus user so
 * DELETE /user/{id} can succeed (deploy log history holds a required relation to users).
 */
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { deletePbLogsForLudusUser } from "@/lib/pocketbase-client"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { userId?: string }
  const userId = body.userId?.trim()
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const { deleted, error } = await deletePbLogsForLudusUser(userId)
  if (error) {
    return NextResponse.json({ error, deleted }, { status: 502 })
  }
  return NextResponse.json({ deleted })
}
