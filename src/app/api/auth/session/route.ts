import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
  // Never expose the API key to the browser
  return NextResponse.json({
    authenticated: true,
    username: session.username,
    isAdmin: session.isAdmin,
    loginAt: session.loginAt,
    /** Ludus GET /user `name` principal when impersonating — client hint for `/user` resolution. */
    impersonationLudusPrincipal:
      session.impersonationApiKey && session.impersonationUserId?.trim()
        ? session.impersonationUserId
        : null,
  })
}
