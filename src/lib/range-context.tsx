"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { RangeAccessEntry } from "./types"
import { queryKeys } from "./query-keys"
import { STALE } from "./query-client"

export interface RangeContextValue {
  ranges: RangeAccessEntry[]
  selectedRangeId: string | null
  /** True while accessible ranges have no data yet (initial load). */
  loading: boolean
  /** True during any accessible-ranges fetch (initial or background). */
  rangesFetching: boolean
  selectRange: (rangeId: string) => void
  refreshRanges: () => Promise<void>
}

const RangeContext = createContext<RangeContextValue>({
  ranges: [],
  selectedRangeId: null,
  loading: true,
  rangesFetching: false,
  selectRange: () => {},
  refreshRanges: async () => {},
})

const STORAGE_KEY = "lux_selected_range"

function extractArray(data: unknown): RangeAccessEntry[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object" && "result" in data) {
    const inner = (data as { result: unknown }).result
    if (Array.isArray(inner)) return inner
  }
  return []
}

async function fetchAccessibleRanges(impersonationHeaders: Record<string, string> = {}): Promise<RangeAccessEntry[]> {
  const res = await fetch("/api/proxy/ranges/accessible", { headers: impersonationHeaders })
  if (!res.ok) return []
  const data = await res.json()
  const list = extractArray(data)
  return [...list].sort((a, b) => (a.rangeNumber ?? 9999) - (b.rangeNumber ?? 9999))
}

export function RangeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const [impersonationHeaders, setImpersonationHeaders] = useState<Record<string, string>>({})

  // Read impersonation headers from sessionStorage (updated by admin page)
  const readImpersonationHeaders = useCallback((): Record<string, string> => {
    if (typeof window === "undefined") return {}
    try {
      const raw = sessionStorage.getItem("goad_impersonation")
      if (!raw) return {}
      const { apiKey, username } = JSON.parse(raw)
      const headers: Record<string, string> = {}
      if (apiKey) headers["X-Impersonate-Apikey"] = apiKey
      if (username) headers["X-Impersonate-As"] = username
      return headers
    } catch {
      return {}
    }
  }, [])

  // The accessible ranges list — powered by TanStack Query (+ persistence in
  // QueryProvider). Stale window + refetchInterval cover ACL changes from
  // group membership without requiring a full reload.
  const { data: ranges = [], isLoading, isFetching: rangesFetching } = useQuery({
    queryKey: [...queryKeys.accessibleRanges(), impersonationHeaders["X-Impersonate-As"] ?? "self"],
    queryFn: () => fetchAccessibleRanges(impersonationHeaders),
    // Group/range ACL changes are made by other users/admins — no client-side
    // invalidation for recipients. Short stale + interval keeps the sidebar honest.
    staleTime: STALE.acl,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  })

  // Align query key + fetch headers with sessionStorage on first paint (impersonation may already be set).
  useEffect(() => {
    setImpersonationHeaders(readImpersonationHeaders())
  }, [readImpersonationHeaders])

  // Sync selectedRangeId whenever the ranges list changes
  useEffect(() => {
    if (isLoading) return
    if (ranges.length === 0) {
      setSelectedRangeId(null)
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved && ranges.some((r) => r.rangeID === saved)) {
      setSelectedRangeId(saved)
    } else {
      setSelectedRangeId(ranges[0].rangeID)
      sessionStorage.setItem(STORAGE_KEY, ranges[0].rangeID)
    }
  }, [ranges, isLoading])

  const selectRange = useCallback((rangeId: string) => {
    setSelectedRangeId(rangeId)
    sessionStorage.setItem(STORAGE_KEY, rangeId)
    window.dispatchEvent(new Event("range-changed"))
  }, [])

  const refreshRanges = useCallback(async () => {
    // refetchQueries (not invalidateQueries) — we need to AWAIT the actual
    // network round-trip so callers (e.g. deploy flow in range/new/page.tsx)
    // are guaranteed the fresh list includes any newly created range before
    // they call selectRange() and navigate away.
    await queryClient.refetchQueries({ queryKey: queryKeys.accessibleRanges() })
  }, [queryClient])

  // When impersonation changes, clear stale range selection and re-fetch
  useEffect(() => {
    const handler = () => {
      const headers = readImpersonationHeaders()
      setImpersonationHeaders(headers)
      setSelectedRangeId(null)
      sessionStorage.removeItem(STORAGE_KEY)
      // Invalidate so the query re-runs with new headers
      queryClient.invalidateQueries({ queryKey: queryKeys.accessibleRanges() })
    }
    window.addEventListener("impersonation-changed", handler)
    return () => window.removeEventListener("impersonation-changed", handler)
  }, [queryClient, readImpersonationHeaders])

  return (
    <RangeContext.Provider
      value={{
        ranges,
        selectedRangeId,
        loading: isLoading,
        rangesFetching,
        selectRange,
        refreshRanges,
      }}
    >
      {children}
    </RangeContext.Provider>
  )
}

export function useRange() {
  return useContext(RangeContext)
}
