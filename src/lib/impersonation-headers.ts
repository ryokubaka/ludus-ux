/**
 * Single source for X-Impersonate-* headers (sessionStorage + in-memory impersonation state).
 */

export const IMPERSONATION_STORAGE_KEY = "goad_impersonation"

/** Read impersonation headers from sessionStorage (browser); call per fetch so storage wins over stale React state. */
export function readImpersonationHeadersFromSessionStorage(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)
    if (!raw) return {}
    const { apiKey, username } = JSON.parse(raw) as { apiKey?: string; username?: string }
    const headers: Record<string, string> = {}
    if (apiKey) headers["X-Impersonate-Apikey"] = apiKey
    if (username) headers["X-Impersonate-As"] = username
    return headers
  } catch {
    return {}
  }
}

/** Headers from an in-memory impersonation object (ImpersonationProvider). */
export function impersonationHeadersFromData(
  data: { username: string; apiKey: string } | null,
): Record<string, string> {
  if (!data) return {}
  return {
    "X-Impersonate-As": data.username,
    "X-Impersonate-Apikey": data.apiKey,
  }
}
