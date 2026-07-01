"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"
import { LOG_PANE_WALL_CLOCK_CLASS } from "@/lib/log-line-timestamp"
import { parseLogLines, LOG_VIRTUALIZE_THRESHOLD, type ParsedLogLine } from "@/lib/log-line-render"
import { stripAnsi } from "@/lib/strip-ansi"
import { usePauseAwareLines } from "./use-pause-aware-lines"
import { useLogSearch } from "./use-log-search"
import { useResizableHeight, parsePxHeight } from "./use-resizable-height"
import {
  LogDockToolbar,
  LogDockSearchBar,
  type LogDockTheme,
  type LogFontSize,
  DEFAULT_FONT_SIZE,
} from "./log-dock-toolbar"
import {
  LogViewerProvider,
  useLogViewer,
  type LogViewerConfig,
  type LogViewerContextValue,
} from "./log-viewer-context"

export type LogViewerProps = LogViewerConfig

const BOTTOM_THRESHOLD = 80

function useLogViewerRuntime(config: LogViewerConfig): LogViewerContextValue {
  const {
    lines,
    onClear,
    onRefresh,
    refreshLoading,
    autoScroll: parentAutoScroll = true,
    className,
    maxHeight = "400px",
    live = false,
    liveLabel,
    downloadFilename = "ludus-deploy",
    fillHeight = false,
    sortOrder = "asc",
    onSortOrderToggle,
    resizable,
    resizeKey,
    minHeight = 140,
  } = config

  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledAwayRef = useRef(false)
  const prevScrollTopRef = useRef(0)
  const prevLinesLenRef = useRef(0)
  const scrollToMatchRef = useRef<((lineIdx: number) => void) | null>(null)
  const liveEdgeScrollRef = useRef<(() => void) | null>(null)
  const [showJumpBtn, setShowJumpBtn] = useState(false)
  const newestFirst = sortOrder === "desc"

  const [localAutoScroll, setLocalAutoScroll] = useState(parentAutoScroll !== false)
  const [fontSize, setFontSize] = useState<LogFontSize>(DEFAULT_FONT_SIZE)
  const [wrap, setWrap] = useState(true)
  const [theme, setTheme] = useState<LogDockTheme>("dark")

  const normalizedLines = useMemo(() => lines.map(stripAnsi), [lines])

  const effectiveAutoScroll = parentAutoScroll !== false && localAutoScroll
  const { displayLines, paused, frozenAt, pause, resume } = usePauseAwareLines(normalizedLines)

  const visibleLines = useMemo(
    () => (newestFirst ? [...displayLines].reverse() : displayLines),
    [displayLines, newestFirst],
  )

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
  } = useLogSearch(visibleLines, {
    normalizeLine: stripAnsi,
    getScrollToMatch: () => scrollToMatchRef.current,
  })

  const scrollToLiveEdge = () => {
    const el = containerRef.current
    if (!el) return
    const override = liveEdgeScrollRef.current
    if (override) override()
    else el.scrollTop = newestFirst ? 0 : el.scrollHeight
    prevScrollTopRef.current = el.scrollTop
    userScrolledAwayRef.current = false
    setShowJumpBtn(false)
  }

  const isNearLiveEdge = (el: HTMLDivElement) =>
    newestFirst
      ? el.scrollTop < BOTTOM_THRESHOLD
      : el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD

  useEffect(() => {
    scrollToLiveEdge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestFirst])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const hasNew = visibleLines.length > prevLinesLenRef.current
    prevLinesLenRef.current = visibleLines.length

    if (visibleLines.length === 0) {
      userScrolledAwayRef.current = false
      prevScrollTopRef.current = 0
      setShowJumpBtn(false)
      return
    }

    if (!effectiveAutoScroll) {
      if (hasNew) setShowJumpBtn(true)
      return
    }

    if (!userScrolledAwayRef.current) {
      scrollToLiveEdge()
    } else if (hasNew) {
      setShowJumpBtn(true)
    }
  }, [visibleLines, effectiveAutoScroll, newestFirst])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    if (isNearLiveEdge(el)) {
      userScrolledAwayRef.current = false
      setShowJumpBtn(false)
    } else if (newestFirst) {
      if (el.scrollTop > prevScrollTopRef.current) userScrolledAwayRef.current = true
    } else if (el.scrollTop < prevScrollTopRef.current) {
      userScrolledAwayRef.current = true
    }
    prevScrollTopRef.current = el.scrollTop
  }

  const dark = theme === "dark"
  const leftSlot = paused ? (
    <span className="text-status-warning font-mono text-xs">
      Paused · {frozenAt} / {lines.length} lines
    </span>
  ) : live ? (
    <span className="flex items-center gap-1.5 text-xs font-mono">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
      <span className={dark ? "text-status-success" : "text-green-600"}>
        {liveLabel ? `${liveLabel} · ` : ""}{lines.length} lines
      </span>
    </span>
  ) : (
    <span className={cn("text-xs font-mono", dark ? "text-muted-foreground" : "text-black")}>
      {lines.length} lines
    </span>
  )

  return {
    lines,
    onClear,
    onRefresh,
    refreshLoading,
    autoScroll: parentAutoScroll,
    className,
    maxHeight,
    live,
    liveLabel,
    downloadFilename,
    fillHeight,
    sortOrder,
    onSortOrderToggle,
    resizable: resizable ?? !fillHeight,
    resizeKey: resizeKey ?? downloadFilename,
    minHeight,
    containerRef,
    userScrolledAwayRef,
    prevScrollTopRef,
    prevLinesLenRef,
    showJumpBtn,
    setShowJumpBtn,
    newestFirst,
    localAutoScroll,
    setLocalAutoScroll,
    fontSize,
    setFontSize,
    wrap,
    setWrap,
    theme,
    setTheme,
    effectiveAutoScroll,
    displayLines,
    paused,
    frozenAt,
    pause,
    resume,
    visibleLines,
    searchOpen,
    searchQuery,
    setSearchQuery,
    setSearchOpen,
    currentMatchIdx,
    matchIndices,
    matchSet,
    searchInputRef,
    matchLineRefsRef,
    scrollToMatchRef,
    liveEdgeScrollRef,
    navigateMatch,
    toggleSearch,
    handleSearchKeyDown,
    scrollToLiveEdge,
    handleScroll,
    dark,
    leftSlot,
  }
}

function LogViewerRoot({ children, ...config }: LogViewerConfig & { children: React.ReactNode }) {
  const value = useLogViewerRuntime(config)
  const { className, fillHeight, dark } = value

  return (
    <LogViewerProvider value={value}>
      <div
        className={cn(
          "rounded-lg border overflow-hidden",
          dark ? "border-zinc-800" : "border-border",
          fillHeight && "flex flex-col flex-1 min-h-0 h-full",
          className,
        )}
      >
        {children}
      </div>
    </LogViewerProvider>
  )
}

function LogViewerToolbar() {
  const {
    lines,
    downloadFilename,
    paused,
    pause,
    resume,
    scrollToLiveEdge,
    localAutoScroll,
    setLocalAutoScroll,
    autoScroll: parentAutoScroll,
    fontSize,
    setFontSize,
    wrap,
    setWrap,
    theme,
    setTheme,
    searchOpen,
    toggleSearch,
    onClear,
    resume: resumeLines,
    onRefresh,
    refreshLoading,
    sortOrder,
    onSortOrderToggle,
    leftSlot,
  } = useLogViewer()

  return (
    <LogDockToolbar
      lines={lines}
      downloadFilename={downloadFilename}
      paused={paused}
      onPause={() => pause(lines.length)}
      onResume={() => { resume(); scrollToLiveEdge() }}
      autoScroll={localAutoScroll}
      onAutoScrollToggle={() => setLocalAutoScroll((v) => !v)}
      showAutoScroll={parentAutoScroll !== false}
      fontSize={fontSize}
      onFontSizeChange={setFontSize}
      wrap={wrap}
      onWrapToggle={() => setWrap((v) => !v)}
      theme={theme}
      onThemeToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      searchOpen={searchOpen}
      onSearchToggle={toggleSearch}
      onClear={onClear ? () => { resumeLines(); onClear() } : undefined}
      onRefresh={onRefresh}
      refreshLoading={refreshLoading}
      sortOrder={sortOrder}
      onSortOrderToggle={onSortOrderToggle}
      leftSlot={leftSlot}
    />
  )
}

function LogViewerSearch() {
  const {
    searchOpen,
    searchQuery,
    setSearchQuery,
    matchIndices,
    currentMatchIdx,
    navigateMatch,
    setSearchOpen,
    searchInputRef,
    handleSearchKeyDown,
    theme,
  } = useLogViewer()

  if (!searchOpen) return null

  return (
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
  )
}

function LogLineContent({ parsed }: { parsed: ParsedLogLine }) {
  return (
    <>
      {parsed.wallTs ? (
        <>
          <span className={LOG_PANE_WALL_CLOCK_CLASS}>[{parsed.wallTs}]</span>
          <span> </span>
        </>
      ) : null}
      {parsed.isRecap && parsed.segments ? (
        <span className="min-w-0">
          {parsed.segments.map((seg, j) => (
            <span key={j} className={seg.cls}>{seg.text}</span>
          ))}
        </span>
      ) : (
        <span className={cn("min-w-0", parsed.bodyCls)}>{parsed.body}</span>
      )}
    </>
  )
}

function LogViewerBody() {
  const {
    visibleLines,
    containerRef,
    handleScroll,
    fillHeight,
    maxHeight,
    fontSize,
    wrap,
    dark,
    searchQuery,
    matchSet,
    matchIndices,
    currentMatchIdx,
    matchLineRefsRef,
    scrollToMatchRef,
    liveEdgeScrollRef,
    theme,
    showJumpBtn,
    scrollToLiveEdge,
    newestFirst,
    resizable,
    resizeKey,
    minHeight,
  } = useLogViewer()

  const parsedLines = useMemo(() => parseLogLines(visibleLines, theme), [visibleLines, theme])
  const useVirtual = parsedLines.length > LOG_VIRTUALIZE_THRESHOLD
  const canResize = Boolean(resizable) && !fillHeight
  useResizableHeight(canResize, containerRef, {
    storageKey: resizeKey,
    defaultHeight: parsePxHeight(maxHeight, 400),
  })

  const rowVirtualizer = useVirtualizer({
    count: parsedLines.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => Math.round(fontSize * 1.7),
    overscan: 16,
  })

  // Windowed viewers scroll matches / to the live edge by index — matched or
  // newest rows may be unmounted, so DOM-ref scrolling won't reach them.
  useEffect(() => {
    if (useVirtual) {
      scrollToMatchRef.current = (idx: number) => rowVirtualizer.scrollToIndex(idx, { align: "center" })
      liveEdgeScrollRef.current = () => {
        const lastIdx = parsedLines.length - 1
        if (lastIdx < 0) return
        rowVirtualizer.scrollToIndex(newestFirst ? 0 : lastIdx, { align: newestFirst ? "start" : "end" })
      }
    } else {
      scrollToMatchRef.current = null
      liveEdgeScrollRef.current = null
    }
    return () => {
      scrollToMatchRef.current = null
      liveEdgeScrollRef.current = null
    }
  }, [useVirtual, rowVirtualizer, scrollToMatchRef, liveEdgeScrollRef, parsedLines.length, newestFirst])

  // Row heights change with wrap / font size — drop cached measurements.
  useEffect(() => {
    if (useVirtual) rowVirtualizer.measure()
  }, [wrap, fontSize, useVirtual, rowVirtualizer])

  return (
    <div className={cn("relative", fillHeight && "flex flex-col flex-1 min-h-0")}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={cn(
          "p-4 overflow-y-auto font-mono leading-relaxed",
          dark ? "bg-black text-gray-200" : "bg-gray-50 text-black",
          wrap ? "whitespace-pre-wrap break-words overflow-x-hidden" : "whitespace-pre overflow-x-auto",
          fillHeight && "flex-1 min-h-0",
          canResize && "resize-y",
        )}
        style={
          fillHeight
            ? { fontSize: `${fontSize}px` }
            : canResize
              ? { fontSize: `${fontSize}px`, minHeight: `${minHeight}px`, maxHeight: "90vh" }
              : { maxHeight, fontSize: `${fontSize}px` }
        }
      >
        {parsedLines.length === 0 ? (
          <p className="italic text-gray-600">No logs yet…</p>
        ) : useVirtual ? (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const i = vi.index
              const parsed = parsedLines[i]
              const isMatch = searchQuery.trim() !== "" && matchSet.has(i)
              const isCurrent = isMatch && matchIndices[currentMatchIdx] === i
              const highlightCls = isCurrent ? "bg-status-warning/40" : isMatch ? "bg-status-warning/20" : ""
              return (
                <div
                  key={i}
                  data-index={i}
                  ref={rowVirtualizer.measureElement}
                  className={cn("log-line", highlightCls)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transform: `translateY(${vi.start}px)`,
                    width: wrap ? "100%" : "max-content",
                    minWidth: wrap ? undefined : "100%",
                  }}
                >
                  <LogLineContent parsed={parsed} />
                </div>
              )
            })}
          </div>
        ) : (
          parsedLines.map((parsed, i) => {
            const isMatch = searchQuery.trim() !== "" && matchSet.has(i)
            const isCurrent = isMatch && matchIndices[currentMatchIdx] === i
            const highlightCls = isCurrent ? "bg-status-warning/40" : isMatch ? "bg-status-warning/20" : ""
            const refCallback = isMatch
              ? (el: HTMLDivElement | null) => {
                  if (el) matchLineRefsRef.current.set(i, el)
                  else matchLineRefsRef.current.delete(i)
                }
              : undefined

            return (
              <div key={i} ref={refCallback} className={cn("log-line", highlightCls)}>
                <LogLineContent parsed={parsed} />
              </div>
            )
          })
        )}
      </div>

      {showJumpBtn && (
        <button
          onClick={scrollToLiveEdge}
          className={cn(
            "absolute flex items-center gap-1.5 px-2.5 py-1 rounded-full",
            "text-xs font-mono shadow-lg transition-colors z-10",
            newestFirst ? "top-3 right-3" : "bottom-3 right-3",
            dark
              ? "bg-primary/90 text-primary-foreground hover:bg-primary"
              : "bg-gray-700/90 text-white hover:bg-gray-600",
          )}
        >
          {newestFirst ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          new logs
        </button>
      )}
    </div>
  )
}

/** Compound API — compose toolbar/search/body slots explicitly when needed. */
export const LogViewerCompound = {
  Root: LogViewerRoot,
  Toolbar: LogViewerToolbar,
  Search: LogViewerSearch,
  Body: LogViewerBody,
}

/** Default all-in-one viewer (backward compatible). */
export function LogViewer(props: LogViewerProps) {
  return (
    <LogViewerRoot {...props}>
      <LogViewerToolbar />
      <LogViewerSearch />
      <LogViewerBody />
    </LogViewerRoot>
  )
}
