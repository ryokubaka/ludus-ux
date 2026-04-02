/**
 * POST /api/admin/user-role
 *
 * Promotes or demotes a Ludus user to/from admin.  Admin-only endpoint.
 *
 * Body: { userID: string; isAdmin: boolean }
 *
 * Ludus does not expose a REST endpoint for updating an existing user's admin
 * flag, so we update the record directly in PocketBase (the backing store used
 * by Ludus).  LUDUS_ROOT_API_KEY must be configured in .env for this to work.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { setPbUserAdmin } from "@/lib/pocketbase-client"
import { bustAdminCache } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let body: { userID?: string; isAdmin?: boolean }
  try { body = await request.json() } catch { body = {} }

  const { userID, isAdmin } = body
  if (!userID || isAdmin === undefined) {
    return NextResponse.json({ error: "userID and isAdmin are required" }, { status: 400 })
  }

  // Prevent an admin from accidentally revoking their own admin status
  if (userID === session.username && !isAdmin) {
    return NextResponse.json({ error: "You cannot revoke your own admin status" }, { status: 400 })
  }

  // Update the isAdmin field directly in PocketBase (Ludus's backing store).
  // The Ludus REST API does not expose a user-update endpoint.
  const err = await setPbUserAdmin(userID, isAdmin)
  if (err) {
    return NextResponse.json(
      { error: `Role change failed: ${err}. Ensure LUDUS_ROOT_API_KEY is set in .env.` },
      { status: 500 },
    )
  }

  // Bust admin data cache so the next GET reflects the role change
  bustAdminCache()

  return NextResponse.json({ ok: true, userID, isAdmin })
}
