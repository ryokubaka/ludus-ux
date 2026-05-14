/**
 * /api/auth/impersonate
 *
 * Manages impersonation state inside the encrypted session cookie so the
 * server knows which user is being impersonated on every request — including
 * SSR prefetch and the API proxy.  This replaces the previous sessionStorage-
 * only approach that broke on page refresh (server couldn't see it).
 *
 * POST  body:
 *   - Preferred: { ludusPrincipal, ludusUserId, sshLogin, apiKey }
 *   - Legacy: { username, apiKey } — sets all identities to `username`.
 * DELETE                     — exit impersonation
 * GET                        — return current impersonation state
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, setSessionCookie } from "@/lib/session"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const p =
    !!(session.impersonationApiKey && session.impersonationUserId?.trim())
  return NextResponse.json({
    impersonating: p,
    /** Ludus `name` (or legacy single username) — X-Impersonate-As. */
    username: session.impersonationUserId ?? null,
    ludusUserId: session.impersonationLudusUserId ?? null,
    sshLogin: session.impersonationSshLogin ?? null,
  })
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let body: {
    apiKey?: string
    ludusPrincipal?: string
    ludusUserId?: string
    sshLogin?: string
    username?: string
  }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  if (!body.apiKey) {
    return NextResponse.json({ error: "apiKey required" }, { status: 400 })
  }

  const ludusPrincipal =
    (body.ludusPrincipal ?? body.username)?.trim() || ""
  if (!ludusPrincipal) {
    return NextResponse.json(
      { error: "ludusPrincipal or username required" },
      { status: 400 },
    )
  }

  const ludusUserId = (body.ludusUserId ?? body.username)?.trim() || ludusPrincipal
  const sshLogin =
    (body.sshLogin ?? body.username)?.trim() || ludusPrincipal

  const updated = {
    ...session,
    impersonationApiKey: body.apiKey,
    impersonationUserId: ludusPrincipal,
    impersonationLudusUserId: ludusUserId,
    impersonationSshLogin: sshLogin,
  }
  const response = NextResponse.json({ ok: true })
  await setSessionCookie(response, updated)
  return response
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const {
    impersonationApiKey: _k,
    impersonationUserId: _u,
    impersonationLudusUserId: _x,
    impersonationSshLogin: _s,
    ...clean
  } = session
  const response = NextResponse.json({ ok: true })
  await setSessionCookie(response, clean)
  return response
}
