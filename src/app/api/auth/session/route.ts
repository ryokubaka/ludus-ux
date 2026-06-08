import { NextRequest, NextResponse } from "next/server"
import { resolveSession, setSessionCookie } from "@/lib/session"
import { resolveLudusIsAdmin } from "@/lib/session-admin-check"

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  const ludusIsAdmin = await resolveLudusIsAdmin(session)
  let isAdmin = session.isAdmin

  const impersonationLudusPrincipal =
    session.impersonationUserId?.trim() ? session.impersonationUserId : null

  if (ludusIsAdmin !== session.isAdmin) {
    isAdmin = ludusIsAdmin
    const response = NextResponse.json({
      authenticated: true,
      username: session.username,
      isAdmin,
      loginAt: session.loginAt,
      impersonationLudusPrincipal:
        session.impersonationApiKey && impersonationLudusPrincipal
          ? impersonationLudusPrincipal
          : null,
    })
    await setSessionCookie(response, { ...session, isAdmin: ludusIsAdmin })
    return response
  }

  const response = NextResponse.json({
    authenticated: true,
    username: session.username,
    isAdmin,
    loginAt: session.loginAt,
    impersonationLudusPrincipal:
      session.impersonationApiKey && impersonationLudusPrincipal
        ? impersonationLudusPrincipal
        : null,
  })
  await setSessionCookie(response, {
    sessionId: session.sessionId,
    username: session.username,
    isAdmin,
    loginAt: session.loginAt,
    impersonationUserId: session.impersonationUserId,
    impersonationLudusUserId: session.impersonationLudusUserId,
    impersonationSshLogin: session.impersonationSshLogin,
  })
  return response
}
