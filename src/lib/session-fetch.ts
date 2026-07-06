let inflight: Promise<Response> | null = null

/**
 * Shared GET /api/auth/session that coalesces the concurrent burst fired by the
 * shell components (header, sidebar, effective-scope, session providers) on page
 * load into a single network request. Each caller gets an independent Response
 * clone, so existing `.ok`/`.json()` parsing is unchanged. Only requests that are
 * still in flight are shared — once one settles, the next call fetches fresh, so
 * there is no stale caching across auth/impersonation changes.
 */
export function fetchSharedSession(): Promise<Response> {
  if (!inflight) {
    inflight = fetch("/api/auth/session", { credentials: "include" })
    void inflight.finally(() => {
      inflight = null
    })
  }
  return inflight.then((r) => r.clone())
}
