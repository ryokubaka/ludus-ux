/**
 * X-Impersonate-As header helpers (sessionStorage + in-memory impersonation state).
 *
 * Security model: the impersonated user's API key is stored ONLY in the
 * encrypted httpOnly session cookie — never in sessionStorage or request
 * headers. This prevents XSS or a compromised extension from reading the key.
 *
 * Routes that need the impersonation API key read it from the session cookie
 * via resolveAdminImpersonationFromRequest (lib/admin-impersonation-request.ts).
 * The X-Impersonate-As header carries only the username as a fast-path hint
 * (e.g. for ownership checks) and for routes that need the effective username
 * before the cookie round-trip completes.
 */

export const IMPERSONATION_STORAGE_KEY = "goad_impersonation"

/**
 * Read impersonation state from sessionStorage (browser).
 * Returns only X-Impersonate-As — the API key is in the httpOnly cookie,
 * not in storage.
 */
export function readImpersonationHeadersFromSessionStorage(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)
    if (!raw) return {}
    const { username } = JSON.parse(raw) as { username?: string }
    if (!username) return {}
    return { "X-Impersonate-As": username }
  } catch {
    return {}
  }
}

/**
 * Headers from an in-memory impersonation object (ImpersonationProvider).
 * Returns only X-Impersonate-As — the API key stays in the cookie.
 */
export function impersonationHeadersFromData(
  data: { username: string } | null,
): Record<string, string> {
  if (!data) return {}
  return { "X-Impersonate-As": data.username }
}
