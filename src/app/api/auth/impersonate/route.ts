/**
 * /api/auth/impersonate
 *
 * Manages impersonation state inside the encrypted session cookie so the
 * server knows which user is being impersonated on every request — including
 * SSR prefetch and the API proxy.  This replaces the previous sessionStorage-
 * only approach that broke on page refresh (server couldn't see it).
 *
 * POST  { username, apiKey } — start impersonating a user
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
  return NextResponse.json({
    impersonating: !!session.impersonationUserId,
    username: session.impersonationUserId ?? null,
  })
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let body: { username?: string; apiKey?: string }
  try { body = await request.json() } catch { body = {} }

  if (!body.username || !body.apiKey) {
    return NextResponse.json({ error: "username and apiKey required" }, { status: 400 })
  }

  const updated = { ...session, impersonationApiKey: body.apiKey, impersonationUserId: body.username }
  const response = NextResponse.json({ ok: true })
  await setSessionCookie(response, updated)
  return response
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { impersonationApiKey, impersonationUserId, ...clean } = session
  void impersonationApiKey
  void impersonationUserId
  const response = NextResponse.json({ ok: true })
  await setSessionCookie(response, clean)
  return response
}
