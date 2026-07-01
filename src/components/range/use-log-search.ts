import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import type { KeyboardEvent } from "react"

export interface UseLogSearchOptions {
  /** Applied before case-folded match — e.g. stripAnsi for raw terminal lines. */
  normalizeLine?: (line: string) => string
  /**
   * Resolve a custom scroll handler when the current match changes. Virtualized
   * viewers return a `scrollToIndex`-backed handler since matched rows may be
   * unmounted; returning null/undefined falls back to `scrollIntoView` on the
   * registered row element.
   */
  getScrollToMatch?: () => ((lineIdx: number) => void) | null | undefined
}

export function useLogSearch(lines: string[], options?: UseLogSearchOptions) {
  const normalizeRef = useRef(options?.normalizeLine)
  normalizeRef.current = options?.normalizeLine
  const getScrollToMatchRef = useRef(options?.getScrollToMatch)
  getScrollToMatchRef.current = options?.getScrollToMatch

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const matchLineRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 220)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Feed the O(n) scan from a debounced copy of `lines` so rapid live-stream
  // appends don't rescan every frame. Update immediately when search is closed
  // (no scan happens then anyway) to keep the reference fresh for the next open.
  const [scanLines, setScanLines] = useState(lines)
  useEffect(() => {
    if (!searchOpen) {
      setScanLines(lines)
      return
    }
    const t = setTimeout(() => setScanLines(lines), 180)
    return () => clearTimeout(t)
  }, [lines, searchOpen])

  const matchIndices = useMemo(() => {
    // Skip the whole scan while the search bar is closed.
    if (!searchOpen || !debouncedQuery.trim()) return []
    const q = debouncedQuery.toLowerCase()
    const normalize = normalizeRef.current ?? ((s: string) => s)
    const result: number[] = []
    scanLines.forEach((line, i) => {
      if (normalize(line).toLowerCase().includes(q)) result.push(i)
    })
    return result
  }, [scanLines, debouncedQuery, searchOpen])

  const matchSet = useMemo(() => new Set(matchIndices), [matchIndices])

  useEffect(() => { setCurrentMatchIdx(0) }, [debouncedQuery])

  useEffect(() => {
    if (matchIndices.length === 0) return
    const lineIdx = matchIndices[currentMatchIdx]
    const customScroll = getScrollToMatchRef.current?.()
    if (customScroll) {
      customScroll(lineIdx)
    } else {
      matchLineRefsRef.current.get(lineIdx)?.scrollIntoView({ block: "nearest" })
    }
  }, [matchIndices, currentMatchIdx])

  useEffect(() => {
    if (lines.length === 0) {
      setSearchQuery("")
      setCurrentMatchIdx(0)
    }
  }, [lines.length])

  const navigateMatch = useCallback((dir: 1 | -1) => {
    setCurrentMatchIdx(i => (i + dir + matchIndices.length) % matchIndices.length)
  }, [matchIndices.length])

  const toggleSearch = useCallback(() => {
    setSearchOpen(o => {
      if (o) {
        setSearchQuery("")
        setCurrentMatchIdx(0)
      }
      return !o
    })
  }, [])

  const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearchOpen(false)
      setSearchQuery("")
    } else if (e.key === "Enter") {
      navigateMatch(e.shiftKey ? -1 : 1)
    }
  }, [navigateMatch])

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    currentMatchIdx,
    matchIndices,
    matchSet,
    searchInputRef,
    matchLineRefsRef,
    navigateMatch,
    toggleSearch,
    handleSearchKeyDown,
  }
}
