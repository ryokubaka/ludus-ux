/**
 * POST /api/range/reconcile-pb
 * Body: { rangeId: string }
 *
 * After a follow-on Ludus deploy (e.g. `network` tag for firewall), PocketBase
 * can stay on DEPLOYING while Ludus has finished — sync PB when safe.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireSession, parseJsonBody } from "@/lib/require-session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { reconcilePbAfterFollowOnLudusDeploy } from "@/lib/goad-ludus-reconcile"
import { logLuxRouteAction } from "@/lib/lux-api-audit"


export async function POST(request: NextRequest) {
  const auth = await requireSession(request)
  if (!auth.ok) return auth.response
  const { session } = auth

  const body = await parseJsonBody<{ rangeId?: string }>(request)

  const rangeId = typeof body.rangeId === "string" ? body.rangeId.trim() : ""
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const imp = resolveAdminImpersonationFromRequest(session, request)
  const ludusUserApiKey = imp.apiKey || session.apiKey

  const result = await reconcilePbAfterFollowOnLudusDeploy(rangeId, ludusUserApiKey)
  logLuxRouteAction(request, session, { detail: `rangeId=${rangeId}` })
  return NextResponse.json(result)
}
