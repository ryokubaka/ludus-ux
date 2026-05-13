"use client"

/**
 * QueryProvider: single QueryClientProvider + manual localStorage persistence (no
 * PersistQueryClientProvider) to avoid the isRestoring flash on SSR-hydrated data.
 * Restore fills only keys missing from HydrationBoundary; persist is 1s debounced.
 * Cache key: `lux_query_cache_v2:${scope}` per effective user / impersonation view.
 */

import { useState, useEffect } from "react"
import { QueryClientProvider, dehydrate, useQueryClient } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { makeQueryClient } from "@/lib/query-client"
import { LEGACY_LUX_QUERY_CACHE_KEY, readClientEffectiveScopeTagSync } from "@/lib/effective-scope"
import {
  EffectiveScopeProvider,
  useEffectiveScopeTag,
} from "@/lib/effective-scope-context"
import { ShellSessionProvider, type ShellSessionSnapshot } from "@/components/providers/shell-session-provider"

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
  const persistenceScopeTag = readClientEffectiveScopeTagSync()
  const queryClient = useQueryClient()

  useEffect(() => {
    const CACHE_KEY = `lux_query_cache_v2:${encodeURIComponent(persistenceScopeTag)}`

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
  }, [queryClient, scopeTag, persistenceScopeTag])

  return null
}

export function QueryProvider({
  children,
  initialScopeTag,
  shellSession,
}: {
  children: React.ReactNode
  initialScopeTag: string
  shellSession: ShellSessionSnapshot | null
}) {
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <EffectiveScopeProvider initialScopeTag={initialScopeTag}>
        <ShellSessionProvider value={shellSession}>
          <QueryPersistenceLayer />
          {children}
        </ShellSessionProvider>
        {process.env.NODE_ENV === "development" ? (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        ) : null}
      </EffectiveScopeProvider>
    </QueryClientProvider>
  )
}
