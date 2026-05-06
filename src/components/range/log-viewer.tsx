"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { isRecapStatsLine, parseRecapStats, getAnsibleLineClass } from "@/lib/ansible-colors"
import { usePauseAwareLines } from "./use-pause-aware-lines"
import { useLogSearch } from "./use-log-search"
import {
  LogDockToolbar,
  LogDockSearchBar,
  type LogDockTheme,
  type LogFontSize,
  DEFAULT_FONT_SIZE,
} from "./log-dock-toolbar"

interface LogViewerProps {
  lines: string[]
  onClear?: () => void
  /** When true, auto-scroll follows new lines. When false (static history view), auto-scroll controls are hidden. */
  autoScroll?: boolean
  className?: string
  maxHeight?: string
  /** Show a live pulse indicator in the toolbar. */
  live?: boolean
  /** Label shown next to the live indicator (e.g. "Range Logs"). */
  liveLabel?: string
  /** Download filename prefix (without extension). */
  downloadFilename?: string
}

const BOTTOM_THRESHOLD = 80

export function LogViewer({
  lines,
  onClear,
  autoScroll: parentAutoScroll = true,
  className,
  maxHeight = "400px",
  live = false,
  liveLabel,
  downloadFilename = "ludus-deploy",
}: LogViewerProps) {
  const containerRef     = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const prevScrollTopRef  = useRef(0)
  const prevLinesLenRef   = useRef(0)
  const [showJumpBtn, setShowJumpBtn] = useState(false)

  // ── Toolbar state ─────────────────────────────────────────────────────────
  const [localAutoScroll, setLocalAutoScroll] = useState(parentAutoScroll !== false)
  const [fontSize, setFontSize]   = useState<LogFontSize>(DEFAULT_FONT_SIZE)
  const [wrap, setWrap]           = useState(true)
  const [theme, setTheme]         = useState<LogDockTheme>("dark")

  const effectiveAutoScroll = parentAutoScroll !== false && localAutoScroll

  // ── Pause ─────────────────────────────────────────────────────────────────
  const { displayLines, paused, frozenAt, pause, resume } = usePauseAwareLines(lines)

  // ── Search (operates on the frozen/display view) ──────────────────────────
  const {
    searchOpen,
    searchQuery,
    setSearchQuery,
    setSearchOpen,
    currentMatchIdx,
    matchIndices,
    matchSet,
    searchInputRef,
    matchLineRefsRef,
    navigateMatch,
    toggleSearch,
    handleSearchKeyDown,
  } = useLogSearch(displayLines)

  // ── Auto-scroll new lines ─────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const hasNew = displayLines.length > prevLinesLenRef.current
    prevLinesLenRef.current = displayLines.length

    if (displayLines.length === 0) {
      userScrolledUpRef.current = false
      prevScrollTopRef.current  = 0
      setShowJumpBtn(false)
      return
    }

    if (!effectiveAutoScroll) {
      if (hasNew) setShowJumpBtn(true)
      return
    }

    if (!userScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight
      prevScrollTopRef.current = el.scrollTop
    } else if (hasNew) {
      setShowJumpBtn(true)
    }
  }, [displayLines, effectiveAutoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
    if (isNearBottom) {
      userScrolledUpRef.current = false
      setShowJumpBtn(false)
    } else if (el.scrollTop < prevScrollTopRef.current) {
      userScrolledUpRef.current = true
    }
    prevScrollTopRef.current = el.scrollTop
  }

  const scrollToBottom = () => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    prevScrollTopRef.current   = el.scrollTop
    userScrolledUpRef.current  = false
    setShowJumpBtn(false)
  }

  // ── Left slot content ─────────────────────────────────────────────────────
  const dark = theme === "dark"
  const leftSlot = paused ? (
    <span className="text-yellow-400 font-mono text-xs">
      Paused · {frozenAt} / {lines.length} lines
    </span>
  ) : live ? (
    <span className="flex items-center gap-1.5 text-xs font-mono">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
      <span className={dark ? "text-green-400" : "text-green-600"}>
        {liveLabel ? `${liveLabel} · ` : ""}{lines.length} lines
      </span>
    </span>
  ) : (
    <span className={cn("text-xs font-mono", dark ? "text-gray-400" : "text-black")}>
      {lines.length} lines
    </span>
  )

  return (
    <div className={cn("rounded-lg border overflow-hidden", dark ? "border-gray-700" : "border-gray-200", className)}>
      <LogDockToolbar
        lines={lines}
        downloadFilename={downloadFilename}
        paused={paused}
        onPause={() => pause(lines.length)}
        onResume={() => { resume(); scrollToBottom() }}
        autoScroll={localAutoScroll}
        onAutoScrollToggle={() => setLocalAutoScroll(v => !v)}
        showAutoScroll={parentAutoScroll !== false}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        wrap={wrap}
        onWrapToggle={() => setWrap(v => !v)}
        theme={theme}
        onThemeToggle={() => setTheme(t => t === "dark" ? "light" : "dark")}
        searchOpen={searchOpen}
        onSearchToggle={toggleSearch}
        onClear={onClear ? () => { resume(); onClear() } : undefined}
        leftSlot={leftSlot}
      />

      {searchOpen && (
        <LogDockSearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          matchIndices={matchIndices}
          currentMatchIdx={currentMatchIdx}
          navigateMatch={navigateMatch}
          onClose={() => setSearchOpen(false)}
          searchInputRef={searchInputRef}
          handleSearchKeyDown={handleSearchKeyDown}
          theme={theme}
        />
      )}

      <div className="relative">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className={cn(
            "p-4 overflow-y-auto font-mono leading-relaxed",
            dark ? "bg-black/80 text-gray-200" : "bg-gray-50 text-black",
            wrap ? "whitespace-pre-wrap break-words overflow-x-hidden" : "whitespace-pre overflow-x-auto",
          )}
          style={{ maxHeight, fontSize: `${fontSize}px` }}
        >
          {displayLines.length === 0 ? (
            <p className="italic text-gray-600">No logs yet…</p>
          ) : (
            displayLines.map((line, i) => {
              const ludusMatch = line.match(/^\[LUDUS\] (.*)$/)
              const goadMatch  = line.match(/^\[GOAD\] (.*)$/)
              const errorMatch = line.match(/^\[ERROR\] (.*)$/)
              const rest = ludusMatch?.[1] ?? goadMatch?.[1] ?? errorMatch?.[1] ?? line

              const isMatch      = searchQuery.trim() !== "" && matchSet.has(i)
              const isCurrent    = isMatch && matchIndices[currentMatchIdx] === i
              const highlightCls = isCurrent ? "bg-yellow-400/40" : isMatch ? "bg-yellow-500/20" : ""
              const refCallback  = isMatch
                ? (el: HTMLDivElement | null) => {
                    if (el) matchLineRefsRef.current.set(i, el)
                    else matchLineRefsRef.current.delete(i)
                  }
                : undefined

              return (
                <div
                  key={i}
                  ref={refCallback}
                  className={cn("log-line flex gap-1.5", highlightCls)}
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
                      {parseRecapStats(rest, theme).map((seg, j) => (
                        <span key={j} className={seg.cls}>{seg.text}</span>
                      ))}
                    </span>
                  ) : (
                    <span className={getAnsibleLineClass(rest, theme)}>{rest}</span>
                  )}
                </div>
              )
            })
          )}
        </div>

        {showJumpBtn && (
          <button
            onClick={scrollToBottom}
            className={cn(
              "absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full",
              "text-xs font-mono shadow-lg transition-colors z-10",
              dark
                ? "bg-primary/90 text-primary-foreground hover:bg-primary"
                : "bg-gray-700/90 text-white hover:bg-gray-600",
            )}
          >
            <ArrowDown className="h-3 w-3" />
            new logs
          </button>
        )}
      </div>
    </div>
  )
}
