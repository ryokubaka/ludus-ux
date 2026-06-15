import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import {
  clearSessionCookie,
  decryptCookiePayload,
  isLegacyCookiePayload,
  readCookieToken,
  sessionTtlMs,
  setSessionCookie,
  toSessionData,
  type CookiePayload,
  type ResolvedSession,
  type SessionData,
} from "./session-edge"
import {
  createSessionCredentials,
  deleteSessionCredentials,
  getSessionCredentials,
  updateSessionCredentials,
} from "./session-credential-store"
import { clearSelectedRangeCookie } from "./selected-range-cookie"

function sessionRemainingTtlMs(loginAt: string): number {
  const elapsed = Date.now() - new Date(loginAt).getTime()
  return Math.max(0, sessionTtlMs() - elapsed)
}

/** Resolve cookie payload + vault credentials (exported for tests). */
export function resolveSessionPayload(payload: CookiePayload): ResolvedSession | null {
  if (isLegacyCookiePayload(payload)) {
    const sessionId = payload.sessionId?.trim() || crypto.randomUUID()
    const slim = toSessionData({ ...payload, sessionId })
    // Cookie accidentally carried apiKey (e.g. ResolvedSession spread) — vault wins.
    const existing = getSessionCredentials(sessionId)
    if (existing) {
      return { ...slim, ...existing }
    }
    const creds = {
      apiKey: payload.apiKey!,
      sshPassword: payload.sshPassword,
      impersonationApiKey: payload.impersonationApiKey,
    }
    createSessionCredentials(sessionId, slim.username, creds, sessionRemainingTtlMs(slim.loginAt))
    return { ...slim, ...creds }
  }

  if (!payload.sessionId?.trim()) return null
  const creds = getSessionCredentials(payload.sessionId)
  if (!creds) return null
  return { ...toSessionData(payload), ...creds }
}

export async function maybeMigrateSessionCookie(
  response: NextResponse,
  payload: CookiePayload,
): Promise<void> {
  if (isLegacyCookiePayload(payload) || payload.apiKey || payload.sshPassword || payload.impersonationApiKey) {
    const slim = toSessionData(payload)
    if (!slim.sessionId) return
    await setSessionCookie(response, slim)
  }
}

export async function resolveSession(request: NextRequest): Promise<ResolvedSession | null> {
  await markRouteDynamic()
  const token = await readCookieToken(request)
  if (!token) return null
  const payload = await decryptCookiePayload(token)
  if (!payload) return null
  return resolveSessionPayload(payload)
}

export async function resolveSessionFromCookies(): Promise<ResolvedSession | null> {
  const token = await readCookieToken()
  if (!token) return null
  const payload = await decryptCookiePayload(token)
  if (!payload) return null
  return resolveSessionPayload(payload)
}

export async function establishSession(
  response: NextResponse,
  args: {
    username: string
    apiKey: string
    isAdmin: boolean
    sshPassword?: string
  },
): Promise<SessionData> {
  const sessionId = crypto.randomUUID()
  const loginAt = new Date().toISOString()
  createSessionCredentials(
    sessionId,
    args.username,
    { apiKey: args.apiKey, sshPassword: args.sshPassword },
    sessionTtlMs(),
  )
  const session: SessionData = {
    sessionId,
    username: args.username,
    isAdmin: args.isAdmin,
    loginAt,
  }
  await setSessionCookie(response, session)
  return session
}

export async function updateSessionImpersonation(
  response: NextResponse,
  session: SessionData,
  args: {
    impersonationApiKey: string
    impersonationUserId: string
    impersonationLudusUserId: string
    impersonationSshLogin: string
  },
): Promise<SessionData> {
  const ok = updateSessionCredentials(session.sessionId, {
    impersonationApiKey: args.impersonationApiKey,
  })
  if (!ok) {
    throw new Error("[session] failed to store impersonation API key in credential vault")
  }
  const updated: SessionData = {
    sessionId: session.sessionId,
    username: session.username,
    isAdmin: session.isAdmin,
    loginAt: session.loginAt,
    impersonationUserId: args.impersonationUserId,
    impersonationLudusUserId: args.impersonationLudusUserId,
    impersonationSshLogin: args.impersonationSshLogin,
  }
  await setSessionCookie(response, updated)
  return updated
}

export async function clearSessionImpersonation(
  response: NextResponse,
  session: SessionData,
): Promise<SessionData> {
  updateSessionCredentials(session.sessionId, { impersonationApiKey: undefined })
  const updated: SessionData = {
    sessionId: session.sessionId,
    username: session.username,
    isAdmin: session.isAdmin,
    loginAt: session.loginAt,
  }
  await setSessionCookie(response, updated)
  return updated
}

export function clearSessionWithCredentials(
  response: NextResponse,
  sessionId?: string,
): void {
  if (sessionId) deleteSessionCredentials(sessionId)
  clearSessionCookie(response)
  clearSelectedRangeCookie(response)
}
