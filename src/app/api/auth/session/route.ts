import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, setSessionCookie } from "@/lib/session"
import { resolveLudusIsAdmin } from "@/lib/session-admin-check"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  const ludusIsAdmin = await resolveLudusIsAdmin(session)
  let isAdmin = session.isAdmin

  if (ludusIsAdmin !== session.isAdmin) {
    isAdmin = ludusIsAdmin
    const response = NextResponse.json({
      authenticated: true,
      username: session.username,
      isAdmin,
      loginAt: session.loginAt,
      impersonationLudusPrincipal:
        session.impersonationApiKey && session.impersonationUserId?.trim()
          ? session.impersonationUserId
          : null,
    })
    await setSessionCookie(response, { ...session, isAdmin: ludusIsAdmin })
    return response
  }

  return NextResponse.json({
    authenticated: true,
    username: session.username,
    isAdmin,
    loginAt: session.loginAt,
    impersonationLudusPrincipal:
      session.impersonationApiKey && session.impersonationUserId?.trim()
        ? session.impersonationUserId
        : null,
  })
}
