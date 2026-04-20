import { QueryClient } from "@tanstack/react-query"

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

  // ACL-driven lists (e.g. blueprints you can see, ranges shared via groups).
  // Shorter than medium so other users' shares show up without minutes of delay.
  acl: 20_000,

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

