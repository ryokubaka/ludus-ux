/**
 * POST /api/range/reconcile-pb
 * Body: { rangeId: string }
 *
 * After a follow-on Ludus deploy (e.g. `network` tag for firewall), PocketBase
 * can stay on DEPLOYING while Ludus has finished — sync PB when safe.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { reconcilePbAfterFollowOnLudusDeploy } from "@/lib/goad-ludus-reconcile"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rangeId = typeof body.rangeId === "string" ? body.rangeId.trim() : ""
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const imp = resolveAdminImpersonationFromRequest(session, request)
  const ludusUserApiKey = imp.apiKey || session.apiKey

  const result = await reconcilePbAfterFollowOnLudusDeploy(rangeId, ludusUserApiKey)
  return NextResponse.json(result)
}
