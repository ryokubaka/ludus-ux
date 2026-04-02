"use client"

import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Trash2, Download, ArrowDown, Search, ChevronUp, ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { isRecapStatsLine, parseRecapStats, getAnsibleLineClass } from "@/lib/ansible-colors"

interface LogViewerProps {
  lines: string[]
  onClear?: () => void
  autoScroll?: boolean
  className?: string
  maxHeight?: string
}

const BOTTOM_THRESHOLD = 80 // px — within this distance = "at bottom"

export function LogViewer({
  lines,
  onClear,
  autoScroll = true,
  className,
  maxHeight = "400px",
}: LogViewerProps) {
  const containerRef      = useRef<HTMLDivElement>(null)
  // true  = user has scrolled up and wants to read history; suppress auto-scroll
  // false = user is at (or near) the bottom; follow new lines automatically
  const userScrolledUpRef = useRef(false)
  const prevScrollTopRef  = useRef(0)
  const prevLinesLenRef   = useRef(0)
  const [showJumpBtn, setShowJumpBtn] = useState(false)

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen]           = useState(false)
  const [searchQuery, setSearchQuery]         = useState("")
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0)
  const searchInputRef   = useRef<HTMLInputElement>(null)
  const matchLineRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())

  // ── Scroll new lines into view ─────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const hasNew = lines.length > prevLinesLenRef.current
    prevLinesLenRef.current = lines.length

    if (lines.length === 0) {
      // Content was cleared — reset everything
      userScrolledUpRef.current = false
      prevScrollTopRef.current  = 0
      setShowJumpBtn(false)
      return
    }

    if (!autoScroll) {
      if (hasNew) setShowJumpBtn(true)
      return
    }

    if (!userScrolledUpRef.current) {
      // User is following the log — jump to bottom immediately
      el.scrollTop = el.scrollHeight
      prevScrollTopRef.current = el.scrollTop
    } else if (hasNew) {
      setShowJumpBtn(true)
    }
  }, [lines, autoScroll])

  // Reset search state when lines become empty
  useEffect(() => {
    if (lines.length === 0) {
      setSearchQuery("")
      setCurrentMatchIdx(0)
    }
  }, [lines])

  // ── Detect user scroll ─────────────────────────────────────────────────────
  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return

    const isNearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD

    if (isNearBottom) {
      // Reached bottom — resume auto-scroll
      userScrolledUpRef.current = false
      setShowJumpBtn(false)
    } else if (el.scrollTop < prevScrollTopRef.current) {
      // scrollTop decreased = user actively scrolled up
      userScrolledUpRef.current = true
    }

    prevScrollTopRef.current = el.scrollTop
  }

  const scrollToBottom = () => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    prevScrollTopRef.current  = el.scrollTop
    userScrolledUpRef.current = false
    setShowJumpBtn(false)
  }

  const downloadLogs = () => {
    const content = lines.join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ludus-deploy-${new Date().toISOString().slice(0, 19)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Search logic ──────────────────────────────────────────────────────────

  const matchIndices = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    const result: number[] = []
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(q)) result.push(i)
    })
    return result
  }, [lines, searchQuery])

  const matchSet = useMemo(() => new Set(matchIndices), [matchIndices])

  // Reset to first match whenever the query changes
  useEffect(() => {
    setCurrentMatchIdx(0)
  }, [searchQuery])

  // Scroll the current match into view whenever it changes
  useEffect(() => {
    if (matchIndices.length === 0) return
    const lineIdx = matchIndices[currentMatchIdx]
    matchLineRefsRef.current.get(lineIdx)?.scrollIntoView({ block: "nearest" })
  }, [matchIndices, currentMatchIdx])

  const navigateMatch = useCallback((dir: 1 | -1) => {
    if (matchIndices.length === 0) return
    setCurrentMatchIdx(i => (i + dir + matchIndices.length) % matchIndices.length)
  }, [matchIndices])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearchOpen(false)
      setSearchQuery("")
    } else if (e.key === "Enter") {
      navigateMatch(e.shiftKey ? -1 : 1)
    }
  }

  const toggleSearch = () => {
    setSearchOpen(o => {
      if (o) {
        setSearchQuery("")
        setCurrentMatchIdx(0)
      }
      return !o
    })
  }

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      {/* ── Log header ── */}
      <div className="bg-muted/50 border-b border-border">
        {/* Top toolbar row */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-mono text-muted-foreground">
            {lines.length} lines
          </span>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" onClick={toggleSearch}>
              <Search className={cn("h-3 w-3", searchOpen ? "text-yellow-400" : "")} />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={downloadLogs} disabled={lines.length === 0}>
              <Download className="h-3 w-3" />
            </Button>
            {onClear && (
              <Button size="icon-sm" variant="ghost" onClick={onClear} disabled={lines.length === 0}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible search row */}
        {searchOpen && (
          <div className="px-3 pb-2 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={searchInputRef}
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search..."
                className="w-full bg-background text-foreground text-xs font-mono px-2 py-1 rounded border border-border focus:outline-none focus:border-ring pr-6"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchOpen(false) }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                {matchIndices.length === 0
                  ? "No results"
                  : `${currentMatchIdx + 1} / ${matchIndices.length}`}
              </span>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => navigateMatch(-1)}
              disabled={matchIndices.length === 0}
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => navigateMatch(1)}
              disabled={matchIndices.length === 0}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="bg-black/80 p-4 overflow-auto font-mono text-xs"
          style={{ maxHeight }}
        >
          {lines.length === 0 ? (
            <p className="text-muted-foreground italic">No logs yet...</p>
          ) : (
            lines.map((line, i) => {
              const ludusMatch = line.match(/^\[LUDUS\] (.*)$/)
              const goadMatch  = line.match(/^\[GOAD\] (.*)$/)
              const errorMatch = line.match(/^\[ERROR\] (.*)$/)
              const rest = ludusMatch?.[1] ?? goadMatch?.[1] ?? errorMatch?.[1] ?? line

              const isMatch   = searchQuery.trim() !== "" && matchSet.has(i)
              const isCurrent = isMatch && matchIndices[currentMatchIdx] === i
              const highlightCls = isCurrent
                ? "bg-yellow-400/40"
                : isMatch
                ? "bg-yellow-500/20"
                : ""
              const refCallback = isMatch
                ? (el: HTMLDivElement | null) => {
                    if (el) matchLineRefsRef.current.set(i, el)
                    else matchLineRefsRef.current.delete(i)
                  }
                : undefined

              return (
                <div
                  key={i}
                  ref={refCallback}
                  className={cn("log-line whitespace-pre-wrap break-words flex gap-1.5", highlightCls)}
                >
                  {ludusMatch && (
                    <span className="flex-shrink-0 text-primary/70 font-bold text-[10px] leading-4 mt-[1px]">[L]</span>
                  )}
                  {goadMatch && (
                    <span className="flex-shrink-0 text-cyan-400/70 font-bold text-[10px] leading-4 mt-[1px]">[G]</span>
                  )}
                  {errorMatch && (
                    <span className="flex-shrink-0 text-red-400/70 font-bold text-[10px] leading-4 mt-[1px]">[E]</span>
                  )}
                  {!ludusMatch && !goadMatch && !errorMatch && (
                    <span className="flex-shrink-0 w-[18px]" />
                  )}
                  {isRecapStatsLine(rest) ? (
                    <span>
                      {parseRecapStats(rest).map((seg, j) => (
                        <span key={j} className={seg.cls}>{seg.text}</span>
                      ))}
                    </span>
                  ) : (
                    <span className={getAnsibleLineClass(rest)}>{rest}</span>
                  )}
                </div>
              )
            })
          )}
        </div>

        {showJumpBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full
                       bg-primary/90 text-primary-foreground text-xs font-mono shadow-lg
                       hover:bg-primary transition-colors z-10"
          >
            <ArrowDown className="h-3 w-3" />
            new logs
          </button>
        )}
      </div>
    </div>
  )
}
