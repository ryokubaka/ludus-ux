import type { NextRequest } from "next/server"
import { liveSessionIsAdmin } from "@/lib/session-admin-check"
import type { ResolvedSession, SessionData } from "@/lib/session"

type SessionImpersonationPick = Pick<
  SessionData,
  "username" | "isAdmin" | "impersonationUserId" | "impersonationLudusUserId" | "impersonationSshLogin"
> & {
  sessionId?: string
  apiKey?: string
  impersonationApiKey?: string
}

/** Resolved cookie-backed impersonation (admin + target API key present). */
export type ResolvedAdminImpersonation = {
  apiKey: string | null
  /** Sent as X-Impersonate-As — Ludus `User.name` (or fallback), not alphanumeric userID. */
  ludusPrincipal: string | null
  ludusUserId: string | null
  sshLogin: string | null
}

const NO_IMPERSONATION: ResolvedAdminImpersonation = {
  apiKey: null,
  ludusPrincipal: null,
  ludusUserId: null,
  sshLogin: null,
}

/** Cookie impersonation fields. Trusts the cookie's admin flag; logs use this. */
export function cookieImpersonation(session: SessionImpersonationPick): ResolvedAdminImpersonation {
  if (!session.isAdmin) return NO_IMPERSONATION
  const principal = session.impersonationUserId?.trim() || null
  const ludusUserId =
    session.impersonationLudusUserId?.trim() || principal
  const sshLogin =
    session.impersonationSshLogin?.trim() || principal
  return {
    apiKey: session.impersonationApiKey?.trim() || null,
    ludusPrincipal: principal,
    ludusUserId: ludusUserId || null,
    sshLogin: sshLogin || null,
  }
}

/**
 * Resolve admin impersonation credentials for a server request.
 *
 * Both X-Impersonate-As AND X-Impersonate-Apikey must be present to use the
 * header path — a partial set falls back to the session cookie so a stale or
 * missing header never silently pairs a new key with the wrong username (or
 * vice versa). When both headers are present they take priority over the cookie
 * because the tab's sessionStorage updates immediately on user switch while the
 * cookie from POST /api/auth/impersonate can still hold the previous impersonated
 * user for one round-trip.
 *
 * Cookie `impersonationUserId` stores the Ludus **name** principal (GET /user
 * field `name`). `impersonationLudusUserId` / `impersonationSshLogin` disambiguate
 * range ownership vs POSIX login when those differ from the principal string.
 */
export async function resolveAdminImpersonationFromRequest(
  session: SessionImpersonationPick,
  request: NextRequest,
): Promise<ResolvedAdminImpersonation> {
  if (!(await liveSessionIsAdmin(session as ResolvedSession))) {
    return NO_IMPERSONATION
  }
  const hKey = request.headers.get("X-Impersonate-Apikey")
  const hAs = request.headers.get("X-Impersonate-As")
  const fromCookie = cookieImpersonation(session)

  if (hKey && hAs) {
    const principal = hAs.trim()
    return {
      apiKey: hKey.trim(),
      ludusPrincipal: principal || null,
      ludusUserId: session.impersonationLudusUserId?.trim() || principal || null,
      sshLogin: session.impersonationSshLogin?.trim() || principal || null,
    }
  }

  if (!fromCookie.apiKey || !fromCookie.ludusPrincipal) {
    return NO_IMPERSONATION
  }
  return fromCookie
}

/** Task list / POSIX-scoped handlers: prefer SSH login when impersonating. */
export async function effectiveImpersonatedOperatorUsername(
  session: { username: string; isAdmin: boolean } & SessionImpersonationPick,
  request: NextRequest,
): Promise<string> {
  const imp = await resolveAdminImpersonationFromRequest(session, request)
  if (imp.apiKey) {
    return (imp.sshLogin || imp.ludusPrincipal || "").trim()
  }
  return session.username
}
