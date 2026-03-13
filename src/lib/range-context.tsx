"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import type { RangeAccessEntry } from "./types"

export interface RangeContextValue {
  ranges: RangeAccessEntry[]
  selectedRangeId: string | null
  loading: boolean
  selectRange: (rangeId: string) => void
  refreshRanges: () => Promise<void>
}

const RangeContext = createContext<RangeContextValue>({
  ranges: [],
  selectedRangeId: null,
  loading: true,
  selectRange: () => {},
  refreshRanges: async () => {},
})

const STORAGE_KEY = "lux_selected_range"

/**
 * Extract an array from a Ludus API response.
 * Ludus wraps most responses in {"result": ...}, so we check for that.
 */
function extractArray(data: unknown): RangeAccessEntry[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object" && "result" in data) {
    const inner = (data as { result: unknown }).result
    if (Array.isArray(inner)) return inner
  }
  return []
}

export function RangeProvider({ children }: { children: React.ReactNode }) {
  const [ranges, setRanges] = useState<RangeAccessEntry[]>([])
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetchRanges = useCallback(async () => {
    let list: RangeAccessEntry[] = []
    try {
      const impHeaders: Record<string, string> = {}
      if (typeof window !== "undefined") {
        try {
          const raw = sessionStorage.getItem("goad_impersonation")
          if (raw) {
            const { apiKey, username } = JSON.parse(raw)
            if (apiKey) impHeaders["X-Impersonate-Apikey"] = apiKey
            if (username) impHeaders["X-Impersonate-As"] = username
          }
        } catch {}
      }

      const res = await fetch("/api/proxy/ranges/accessible", { headers: impHeaders })
      if (res.ok) {
        const data = await res.json()
        if (mountedRef.current) list = extractArray(data)
      }
    } catch {
      // Not authenticated or network error — list stays empty
    }

    if (!mountedRef.current) return

    // Sort by rangeNumber ascending so the first-created range (lowest number)
    // is always list[0] — used as the fallback default when no preference is saved.
    const sorted = [...list].sort((a, b) => (a.rangeNumber ?? 9999) - (b.rangeNumber ?? 9999))
    setRanges(sorted)

    if (sorted.length === 0) {
      // No accessible ranges (endpoint unavailable, user has none, etc.)
      // Clear any stale selection so the dashboard falls back to GET /range (default)
      setSelectedRangeId(null)
      sessionStorage.removeItem(STORAGE_KEY)
    } else {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved && sorted.some((r) => r.rangeID === saved)) {
        // Saved preference is still valid — keep it
        setSelectedRangeId(saved)
      } else {
        // No valid saved preference: default to the first-created range (lowest rangeNumber)
        setSelectedRangeId(sorted[0].rangeID)
        sessionStorage.setItem(STORAGE_KEY, sorted[0].rangeID)
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchRanges()
    return () => { mountedRef.current = false }
  }, [fetchRanges])

  // When impersonation changes, immediately clear stale range selection
  // then re-fetch the new user's ranges.
  useEffect(() => {
    const handler = () => {
      setSelectedRangeId(null)
      sessionStorage.removeItem(STORAGE_KEY)
      setLoading(true)
      fetchRanges()
    }
    window.addEventListener("impersonation-changed", handler)
    return () => window.removeEventListener("impersonation-changed", handler)
  }, [fetchRanges])

  const selectRange = useCallback((rangeId: string) => {
    setSelectedRangeId(rangeId)
    sessionStorage.setItem(STORAGE_KEY, rangeId)
    window.dispatchEvent(new Event("range-changed"))
  }, [])

  return (
    <RangeContext.Provider value={{ ranges, selectedRangeId, loading, selectRange, refreshRanges: fetchRanges }}>
      {children}
    </RangeContext.Provider>
  )
}

export function useRange() {
  return useContext(RangeContext)
}
