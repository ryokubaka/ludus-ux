import { QueryClient } from "@tanstack/react-query"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"

// ---------------------------------------------------------------------------
// staleTime tiers
//
// Controls how long cached data is considered fresh before a background
// revalidation is triggered on next mount / window focus.
// ---------------------------------------------------------------------------
export const STALE = {
  // Range status / VM list — already polled every 15 s; treat cache as always
  // stale so refetchInterval controls freshness, not staleTime.
  realtime: 0,

  // Range list, range config — changes on user action; 30 s is enough to avoid
  // redundant fetches during normal navigation.
  short: 30_000,

  // Blueprints, snapshots, ansible roles — change infrequently; 2 min is safe.
  medium: 2 * 60_000,

  // Templates, users, groups — rarely change; 5 min avoids hammering the API
  // on pages that are visited often (e.g. sidebar navigation to Templates).
  long: 5 * 60_000,
} as const

// ---------------------------------------------------------------------------
// QueryClient
//
// Created once here; imported by the provider.  Defaults apply to all queries
// unless overridden at the call site.
// ---------------------------------------------------------------------------
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.short,
        // Don't retry on 4xx errors — they're not transient.
        retry: (failureCount, error) => {
          if (error instanceof Error && /40[0-9]/.test(error.message)) return false
          return failureCount < 2
        },
        // Refetch when the window regains focus so navigating back to a tab
        // that has been idle refreshes data automatically.
        refetchOnWindowFocus: true,
      },
    },
  })
}

// ---------------------------------------------------------------------------
// localStorage persister
//
// Serialises the entire query cache to localStorage under one key.  On the
// next page load (even after a hard refresh) TanStack Query restores the cache
// synchronously before the first component render, so pages display cached
// data immediately rather than a loading spinner.
//
// We gate this on `typeof window !== "undefined"` to avoid SSR errors; the
// persister is only wired up on the client inside QueryProvider.
// ---------------------------------------------------------------------------
export function makePersister() {
  if (typeof window === "undefined") return null

  return createSyncStoragePersister({
    storage: window.localStorage,
    key: "lux_query_cache",
    // Throttle writes to avoid hammering localStorage on rapid updates
    // (e.g. during dashboard 15-second polling).
    throttleTime: 1000,
  })
}
