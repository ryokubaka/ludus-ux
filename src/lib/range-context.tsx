"use client"

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { RangeAccessEntry } from "./types"
import { queryKeys } from "./query-keys"
import { STALE } from "./query-client"
import { extractArray } from "./utils"
import { readClientEffectiveScopeTagSync } from "./effective-scope"
import { readImpersonationHeadersFromSessionStorage } from "./impersonation-headers"
import { syncSelectedRangeCookie } from "./sync-selected-range-cookie"

export interface RangeContextValue {
  ranges: RangeAccessEntry[]
  selectedRangeId: string | null
  /** True while accessible ranges have no data yet (initial load). */
  loading: boolean
  /** True during any accessible-ranges fetch (initial or background). */
  rangesFetching: boolean
  /** When true, selectRange ignores clicks on ranges other than the current one. */
  rangeSelectionLocked: boolean
  setRangeSelectionLocked: (locked: boolean) => void
  selectRange: (rangeId: string) => void
  refreshRanges: () => Promise<void>
}

const RangeContext = createContext<RangeContextValue>({
  ranges: [],
  selectedRangeId: null,
  loading: true,
  rangesFetching: false,
  rangeSelectionLocked: false,
  setRangeSelectionLocked: () => {},
  selectRange: () => {},
  refreshRanges: async () => {},
})

const STORAGE_KEY = "lux_selected_range"

async function fetchAccessibleRanges(): Promise<RangeAccessEntry[]> {
  const res = await fetch("/api/proxy/ranges/accessible", {
    headers: readImpersonationHeadersFromSessionStorage(),
  })
  if (!res.ok) return []
  const data = await res.json()
  const list = extractArray<RangeAccessEntry>(data)
  return [...list].sort((a, b) => (a.rangeNumber ?? 9999) - (b.rangeNumber ?? 9999))
}

function accessibleRangesPredicate(q: { queryKey: unknown }): boolean {
  const k = q.queryKey
  return (
    Array.isArray(k) &&
    k.length >= 4 &&
    k[0] === "@sc" &&
    k[2] === "ranges" &&
    k[3] === "accessible"
  )
}

export function RangeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  /** Storage + login mirror — query key must not lag `useEffectiveScopeTag` after impersonation. */
  const rangesScopeTag = readClientEffectiveScopeTagSync()
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const [rangeSelectionLocked, setRangeSelectionLocked] = useState(false)
  const [tabVisible, setTabVisible] = useState(true)

  useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState === "visible")
    onVisibility()
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  const { data: ranges = [], isLoading, isFetching: rangesFetching, status } = useQuery({
    queryKey: queryKeys.accessibleRangesList(rangesScopeTag),
    queryFn: fetchAccessibleRanges,
    staleTime: STALE.acl,
    refetchInterval: tabVisible ? 45_000 : 60_000,
    refetchIntervalInBackground: false,
  })

  // Keep sidebar/dashboard range across navigation and range-list refetches.
  // Only fall back to the first range when there is no valid in-memory or
  // persisted choice.  Do not clear sessionStorage on transient [] (errors,
  // cache clears, key churn) — that used to snap users back to the default
  // range after e.g. leaving GOAD for the dashboard.  Impersonation enter/exit
  // still clears selection via `impersonation-changed` before this runs.
  useEffect(() => {
    if (isLoading) return

    if (ranges.length === 0) {
      if (status === "success") {
        setSelectedRangeId(null)
        sessionStorage.removeItem(STORAGE_KEY)
        syncSelectedRangeCookie(null)
      }
      return
    }

    const saved = sessionStorage.getItem(STORAGE_KEY)

    if (selectedRangeId && ranges.some((r) => r.rangeID === selectedRangeId)) {
      if (saved !== selectedRangeId) {
        sessionStorage.setItem(STORAGE_KEY, selectedRangeId)
        syncSelectedRangeCookie(selectedRangeId)
      }
      return
    }

    if (saved && ranges.some((r) => r.rangeID === saved)) {
      setSelectedRangeId(saved)
      syncSelectedRangeCookie(saved)
      return
    }

    const first = ranges[0].rangeID
    setSelectedRangeId(first)
    sessionStorage.setItem(STORAGE_KEY, first)
    syncSelectedRangeCookie(first)
  }, [ranges, isLoading, status, selectedRangeId])

  const selectRange = useCallback((rangeId: string) => {
    setSelectedRangeId((current) => {
      if (rangeSelectionLocked && rangeId !== current) return current
      sessionStorage.setItem(STORAGE_KEY, rangeId)
      syncSelectedRangeCookie(rangeId)
      window.dispatchEvent(new Event("range-changed"))
      return rangeId
    })
  }, [rangeSelectionLocked])

  const refreshRanges = useCallback(async () => {
    // Invalidate every scoped copy of the accessible-ranges query — a single
    // exact refetch can miss the active observer's key after impersonation /
    // scope hydration timing, leaving deleted ranges visible in the sidebar.
    await queryClient.invalidateQueries({ predicate: accessibleRangesPredicate })
  }, [queryClient])

  useEffect(() => {
    const handler = () => {
      setSelectedRangeId(null)
      sessionStorage.removeItem(STORAGE_KEY)
      syncSelectedRangeCookie(null)
      void queryClient.invalidateQueries({ predicate: accessibleRangesPredicate })
    }
    window.addEventListener("impersonation-changed", handler)
    return () => window.removeEventListener("impersonation-changed", handler)
  }, [queryClient])

  const value = useMemo<RangeContextValue>(
    () => ({
      ranges,
      selectedRangeId,
      loading: isLoading,
      rangesFetching,
      rangeSelectionLocked,
      setRangeSelectionLocked,
      selectRange,
      refreshRanges,
    }),
    // setRangeSelectionLocked is a stable useState setter.
    [ranges, selectedRangeId, isLoading, rangesFetching, rangeSelectionLocked, selectRange, refreshRanges],
  )

  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>
}

export function useRange() {
  return useContext(RangeContext)
}
