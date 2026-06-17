import { LEGACY_LUX_QUERY_CACHE_KEY } from "@/lib/effective-scope"
import { IMPERSONATION_STORAGE_KEY } from "@/lib/impersonation-headers"

/** Same-tab signal after login/logout so providers drop stale identity. */
export const AUTH_CHANGED_EVENT = "lux-auth-changed"

const QUERY_CACHE_PREFIX = "lux_query_cache_v2:"
const SIDEBAR_ADMIN_CACHE_KEY = "ludus-sidebar-is-admin"

/** Drop client-side identity, impersonation, and persisted query buckets. */
export function clearLuxClientAuthState(): void {
  if (typeof window === "undefined") return

  try {
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY)
    sessionStorage.removeItem("ludus-auth-username")
    sessionStorage.removeItem(SIDEBAR_ADMIN_CACHE_KEY)
    sessionStorage.removeItem("ludus-sidebar-goad-enabled")
  } catch {
    /* private mode */
  }

  try {
    localStorage.removeItem(LEGACY_LUX_QUERY_CACHE_KEY)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(QUERY_CACHE_PREFIX)) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    /* private mode */
  }

  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT))
}
