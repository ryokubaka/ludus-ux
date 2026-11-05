import { NextResponse } from "next/server"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus/ludus-user-from-profile"
import { setSessionCookie, type ResolvedSession } from "@/lib/session/session"

/** How long a live admin answer is reused for one vault session. */
export const LIVE_ADMIN_CACHE_MS = 60_000

type LiveAdminSession = Pick<ResolvedSession, "isAdmin" | "username"> & {
  sessionId?: string
  apiKey?: string
}

const adminCache = new Map<string, { at: number; isAdmin: boolean }>()

/** Resolve current Ludus admin flag for the logged-in user (same logic as login). */
export async function resolveLudusIsAdmin(
  session: Pick<ResolvedSession, "apiKey" | "isAdmin" | "username">,
): Promise<boolean> {
  try {
    const result = await ludusRequest<unknown>("/user", { apiKey: session.apiKey })
    if (result.error || result.status !== 200) return session.isAdmin
    const profile = ludusCallerFromGetUser(result.data, session.username)
    if (!profile) return session.isAdmin
    return profile.user.isAdmin
  } catch {
    return session.isAdmin
  }
}

/**
 * Whether an admin branch may run. A cookie that is not admin skips Ludus.
 * A cookie that is admin is checked, then reused for about a minute per vault
 * session. Ludus being unreachable keeps the cookie value, same as requireAdmin.
 */
export async function liveSessionIsAdmin(session: LiveAdminSession): Promise<boolean> {
  if (!session.isAdmin) return false
  const key = `${session.sessionId ?? ""}\0${session.username}`
  const now = Date.now()
  const hit = adminCache.get(key)
  if (hit && now - hit.at < LIVE_ADMIN_CACHE_MS) return hit.isAdmin
  const isAdmin = await resolveLudusIsAdmin({ ...session, apiKey: session.apiKey ?? "" })
  adminCache.set(key, { at: now, isAdmin })
  return isAdmin
}

/** Test hook. The cache is process-local and must not leak between cases. */
export function clearLiveAdminCache(): void {
  adminCache.clear()
}

/**
 * When Ludus says the cookie's admin flag is stale, rewrite the cookie on the
 * response this request actually returns.
 */
export async function refreshRevokedAdminCookie<T extends NextResponse>(
  response: T,
  session: ResolvedSession,
  liveAdmin: boolean,
): Promise<T> {
  if (session.isAdmin && !liveAdmin) {
    await setSessionCookie(response, { ...session, isAdmin: false })
  }
  return response
}
