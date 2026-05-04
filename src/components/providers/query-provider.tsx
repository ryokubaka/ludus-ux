"use client"

/**
 * QueryProvider
 *
 * Wraps the app with a single, stable QueryClientProvider.  Persistence is
 * handled manually via useEffect rather than PersistQueryClientProvider.
 *
 * WHY NOT PersistQueryClientProvider?
 * ─────────────────────────────────────
 * The original implementation deferred creating the persister into a useEffect
 * to avoid SSR hydration errors (#418/#422).  This caused a provider switch on
 * mount:  QueryClientProvider → PersistQueryClientProvider.  Because they are
 * different React component types, the entire subtree unmounts and remounts.
 * Critically, PersistQueryClientProvider sets queryClient.isRestoring = true
 * during the async localStorage restore.  While isRestoring is true TanStack
 * Query returns status "pending" / isLoading = true for every query — even
 * queries already populated by SSR's HydrationBoundary.  This produced the
 * visible "data appears → loading spinner → data appears again" flash.
 *
 * CURRENT APPROACH
 * ─────────────────
 * We always render the same QueryClientProvider (no switching, no isRestoring).
 * Persistence is wired up once in useEffect:
 *
 *  • RESTORE  – Reads localStorage and populates cache keys the SSR
 *               HydrationBoundary did NOT already fill in.  SSR data takes
 *               priority: if a key is already present we skip it.  This runs
 *               synchronously on the main thread so data is available before
 *               the browser paints (no async gap, no flash).
 *
 *  • PERSIST  – Subscribes to QueryClient cache changes and writes a
 *               throttled snapshot to localStorage (1 s debounce) so the
 *               next page-load can restore.
 *
 * localStorage keys are namespaced per effective user + impersonation view
 * (`lux_query_cache_v2:${scope}`) so one browser profile never restores
 * another identity's TanStack snapshot.
 */

import { useState, useEffect } from "react"
import { QueryClientProvider, dehydrate, useQueryClient } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { makeQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { LEGACY_LUX_QUERY_CACHE_KEY } from "@/lib/effective-scope"
import {
  EffectiveScopeProvider,
  useEffectiveScopeTag,
} from "@/lib/effective-scope-context"

const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 h

interface PersistedQuery {
  queryKey: unknown[]
  state: { data: unknown; status: string }
}

interface PersistedClient {
  timestamp: number
  clientState?: { queries?: PersistedQuery[] }
}

function QueryPersistenceLayer() {
  const scopeTag = useEffectiveScopeTag()
  const queryClient = useQueryClient()

  useEffect(() => {
    const CACHE_KEY = `lux_query_cache_v2:${encodeURIComponent(scopeTag)}`

    try {
      localStorage.removeItem(LEGACY_LUX_QUERY_CACHE_KEY)
    } catch {
      /* ignore */
    }

    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const stored = JSON.parse(raw) as PersistedClient
        if (Date.now() - stored.timestamp <= MAX_AGE_MS) {
          for (const q of stored.clientState?.queries ?? []) {
            if (
              q.state.status === "success" &&
              queryClient.getQueryData(q.queryKey) === undefined
            ) {
              queryClient.setQueryData(q.queryKey, q.state.data)
            }
          }
        } else {
          localStorage.removeItem(CACHE_KEY)
        }
      }
    } catch {
      /* malformed JSON or private-browsing quota */
    }

    void queryClient.invalidateQueries({
      queryKey: queryKeys.accessibleRangesList(scopeTag),
      exact: false,
    })
    void queryClient.invalidateQueries({
      queryKey: queryKeys.blueprints(scopeTag),
      exact: false,
    })

    let saveTimer: ReturnType<typeof setTimeout> | null = null

    const persist = () => {
      try {
        const state = dehydrate(queryClient, {
          shouldDehydrateQuery: (q) => q.state.status === "success",
        })
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ timestamp: Date.now(), clientState: state }),
        )
      } catch {
        /* localStorage full or unavailable */
      }
    }

    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(persist, 1_000)
    })

    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      unsubscribe()
    }
  }, [queryClient, scopeTag])

  return null
}

export function QueryProvider({
  children,
  initialScopeTag,
}: {
  children: React.ReactNode
  initialScopeTag: string
}) {
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <EffectiveScopeProvider initialScopeTag={initialScopeTag}>
        <QueryPersistenceLayer />
        {children}
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      </EffectiveScopeProvider>
    </QueryClientProvider>
  )
}
