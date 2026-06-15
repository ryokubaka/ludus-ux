import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import {
  resolveSession,
  setSessionCookie,
  type ResolvedSession,
  type SessionData,
} from "@/lib/session"
import { resolveLudusIsAdmin } from "@/lib/session-admin-check"

export type RequireAdminOk = {
  ok: true
  session: ResolvedSession
  /** Apply to the route response when Ludus admin flag differs from the cookie. */
  applyCookieRefresh?: (response: NextResponse) => Promise<void>
}

export type RequireAdminResult = RequireAdminOk | { ok: false; response: NextResponse }

/**
 * Gate admin routes. With liveCheck (default), re-validates isAdmin against Ludus
 * and refreshes a stale cookie when privileges were revoked.
 */
export async function requireAdmin(
  request: NextRequest,
  options?: { liveCheck?: boolean },
): Promise<RequireAdminResult> {
  await markRouteDynamic()
  const resolved = await resolveSession(request)
  if (!resolved) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }
  const session: ResolvedSession = resolved

  const liveCheck = options?.liveCheck ?? true

  if (!liveCheck) {
    if (!session.isAdmin) {
      return { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) }
    }
    return { ok: true, session }
  }

  const ludusIsAdmin = await resolveLudusIsAdmin(session)
  if (!ludusIsAdmin) {
    const response = NextResponse.json({ error: "Admin access required" }, { status: 403 })
    if (session.isAdmin) {
      await setSessionCookie(response, { ...session, isAdmin: false })
    }
    return { ok: false, response }
  }

  if (ludusIsAdmin !== session.isAdmin) {
    const refreshed = { ...session, isAdmin: ludusIsAdmin }
    return {
      ok: true,
      session: refreshed,
      applyCookieRefresh: async (response: NextResponse) => {
        await setSessionCookie(response, refreshed)
      },
    }
  }

  return { ok: true, session }
}

/** Call after building a successful admin response when applyCookieRefresh is set. */
export async function finishAdminResponse(
  response: NextResponse,
  admin: RequireAdminOk,
): Promise<NextResponse> {
  if (admin.applyCookieRefresh) {
    await admin.applyCookieRefresh(response)
  }
  return response
}
