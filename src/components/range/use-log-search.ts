import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import type { KeyboardEvent } from "react"

export interface UseLogSearchOptions {
  /** Applied before case-folded match — e.g. stripAnsi for raw terminal lines. */
  normalizeLine?: (line: string) => string
}

export function useLogSearch(lines: string[], options?: UseLogSearchOptions) {
  const normalizeRef = useRef(options?.normalizeLine)
  normalizeRef.current = options?.normalizeLine

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const matchLineRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())

  const matchIndices = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    const normalize = normalizeRef.current ?? ((s: string) => s)
    const result: number[] = []
    lines.forEach((line, i) => {
      if (normalize(line).toLowerCase().includes(q)) result.push(i)
    })
    return result
    // normalizeRef is stable (ref), intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, searchQuery])

  const matchSet = useMemo(() => new Set(matchIndices), [matchIndices])

  useEffect(() => { setCurrentMatchIdx(0) }, [searchQuery])

  useEffect(() => {
    if (matchIndices.length === 0) return
    const lineIdx = matchIndices[currentMatchIdx]
    matchLineRefsRef.current.get(lineIdx)?.scrollIntoView({ block: "nearest" })
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
