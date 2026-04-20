/**
 * Server-only prefetch utilities for TanStack Query + Next.js App Router.
 *
 * DESIGN: Every function here is non-blocking.
 *
 * Each function reads from an in-process SWR cache and returns whatever data
 * is available right now.  If the cache is warm (fresh or stale), the data is
 * injected into the HydrationBoundary so the client renders instantly.  If the
 * cache is cold (first-ever request after a container start), the function
 * returns an empty dehydrated state — the client falls back to its own
 * client-side fetch and shows a loading state.
 *
 * In both cases, a background revalidation is triggered so the next request
 * gets up-to-date cached data.
 *
 * Result: HTML delivery is NEVER blocked by a live Ludus API call.
 * Only the very first request after a cold container start may show a loading
 * state; every subsequent request renders with cached data.
 */

import "server-only"
import { QueryClient, dehydrate } from "@tanstack/react-query"
import { getSession } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { SWRCache } from "@/lib/server-cache"
import { getAdminDataCached } from "@/lib/admin-data"
import { queryKeys } from "@/lib/query-keys"
import type { RangeAccessEntry, RangeObject } from "@/lib/types"
import { extractArray } from "@/lib/utils"

// ── Module-level SWR caches (persist across requests in the same process) ──

/** Accessible ranges per effective API key (30 s TTL) */
const rangesCache = new SWRCache<RangeAccessEntry[]>(30_000)

/** Ludus server version (rarely changes — 5 min TTL) */
const versionCache = new SWRCache<unknown>(5 * 60_000)

/** Default range status per effective API key (15 s TTL — matches client poll) */
const rangeStatusCache = new SWRCache<RangeObject | null>(15_000)

// ── Prefetch functions ───────────────────────────────────────────────────────

/**
 * Global prefetch — injected into the root layout, benefits every page.
 * Serves:
 *   - Accessible ranges  (drives the sidebar range selector + range context)
 *   - Ludus version      (shown in the dashboard stats card)
 *
 * Respects impersonation via the session cookie.
 */
export async function prefetchGlobal() {
  const queryClient = new QueryClient()
  try {
    const session = await getSession()
    if (!session) return dehydrate(queryClient)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey
    const effectiveUserId = session.impersonationUserId ?? "self"
    const isImpersonating = !!session.impersonationUserId

    // peek() is synchronous: returns from cache or null (never awaits Ludus)
    const ranges = rangesCache.peek(
      effectiveApiKey,
      () => ludusRequest<unknown>("/ranges/accessible", { apiKey: effectiveApiKey })
        .then((r) => {
          const list = extractArray<RangeAccessEntry>(r.data)
          return [...list].sort((a, b) => (a.rangeNumber ?? 9999) - (b.rangeNumber ?? 9999))
        }),
    )

    const version = !isImpersonating
      ? versionCache.peek(
          "global",
          () => ludusRequest<unknown>("/version", { apiKey: session.apiKey })
            .then((r) => r.data ?? null),
        )
      : null

    if (ranges) queryClient.setQueryData([...queryKeys.accessibleRanges(), effectiveUserId], ranges)
    if (version) queryClient.setQueryData(queryKeys.version(), version)
  } catch { /* best-effort */ }
  return dehydrate(queryClient)
}

/**
 * Dashboard prefetch — default range status for the authenticated user.
 * Key: rangeStatus(null) — matches the client query before selectedRangeId
 * is restored from localStorage.
 */
export async function prefetchRangeStatus() {
  const queryClient = new QueryClient()
  try {
    const session = await getSession()
    if (!session) return dehydrate(queryClient)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey

    const status = rangeStatusCache.peek(
      effectiveApiKey,
      () => ludusRequest<RangeObject>("/range", { apiKey: effectiveApiKey })
        .then((r) => r.data ?? null),
    )

    if (status !== undefined) queryClient.setQueryData(queryKeys.rangeStatus(null), status)
  } catch { /* best-effort */ }
  return dehydrate(queryClient)
}

/**
 * Admin page prefetch — the heaviest page.
 * getAdminDataCached() is non-blocking: reads the SWR cache and triggers a
 * background revalidation, never waiting for the Ludus API.
 */
export async function prefetchAdminData() {
  const queryClient = new QueryClient()
  try {
    const session = await getSession()
    if (!session?.isAdmin) return dehydrate(queryClient)

    const data = getAdminDataCached(session.apiKey)
    if (data) queryClient.setQueryData(queryKeys.adminRangesData(), data)
  } catch { /* best-effort */ }
  return dehydrate(queryClient)
}
