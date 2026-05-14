/**
 * Stable scope tag for TanStack Query keys + localStorage persistence buckets.
 * Format: `${loginUsername}|${viewAsUsername}` where viewAs is the impersonated
 * Ludus `User.name` principal (cookie `impersonationUserId`, same as X-Impersonate-As) or "self".
 */

import type { SessionData } from "@/lib/session"
import { IMPERSONATION_STORAGE_KEY } from "@/lib/impersonation-headers"

export const LEGACY_LUX_QUERY_CACHE_KEY = "lux_query_cache"

export function effectiveScopeTagFromSession(session: Pick<SessionData, "username" | "impersonationUserId">): string {
  return `${session.username}|${session.impersonationUserId ?? "self"}`
}

/** SessionStorage mirror of login username (sidebar / GOAD pages set this). */
export function readLoginUsernameSync(): string {
  if (typeof window === "undefined") return ""
  try {
    return sessionStorage.getItem("ludus-auth-username") || ""
  } catch {
    return ""
  }
}

export function readImpersonationUsernameSync(): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as { username?: string }
    return u.username ? String(u.username) : null
  } catch {
    return null
  }
}

/** Best-effort before /api/auth/session resolves — avoids restoring wrong user's cache. */
export function readClientEffectiveScopeTagSync(): string {
  const login = readLoginUsernameSync() || "_pending"
  const imp = readImpersonationUsernameSync()
  return `${login}|${imp ?? "self"}`
}

/**
 * Authoritative scope: session cookie (login + server-side impersonation) with
 * sessionStorage impersonation as a short-lived fallback while POST /impersonate is in flight.
 */
export async function fetchClientEffectiveScopeTag(): Promise<string> {
  let login = "_unknown"
  try {
    const sr = await fetch("/api/auth/session")
    if (sr.ok) {
      const s = (await sr.json()) as { username?: string }
      if (s.username) login = String(s.username)
    } else if (sr.status === 401) {
      login = "_guest"
    }
  } catch {
    login = readLoginUsernameSync() || "_unknown"
  }

  let view = "self"
  try {
    const ir = await fetch("/api/auth/impersonate")
    if (ir.ok) {
      const j = (await ir.json()) as { impersonating?: boolean; username?: string | null }
      if (j.impersonating && j.username) view = String(j.username)
    }
  } catch {
    /* ignore */
  }

  if (view === "self") {
    const fromStorage = readImpersonationUsernameSync()
    if (fromStorage) view = fromStorage
  }

  return `${login}|${view}`
}
