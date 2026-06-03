"use client"

import type { ReactNode, RefObject, KeyboardEvent } from "react"
import { Pause, Play, ChevronsDown, WrapText, Sun, Moon, Search, Copy, Download, Trash2, ChevronUp, ChevronDown, X, RefreshCw, ArrowDownAZ, ArrowUpAZ } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type LogDockTheme = "dark" | "light"

export const LOG_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18] as const
export type LogFontSize = (typeof LOG_FONT_SIZES)[number]
export const DEFAULT_FONT_SIZE: LogFontSize = 12

export interface LogDockToolbarProps {
  /** Full lines buffer — used for copy and download (not the frozen displayLines). */
  lines: string[]
  downloadFilename?: string
  paused: boolean
  onPause: () => void
  onResume: () => void
  autoScroll: boolean
  onAutoScrollToggle: () => void
  /** Hide the auto-scroll control (e.g. for static history viewers). */
  showAutoScroll?: boolean
  fontSize: LogFontSize
  onFontSizeChange: (s: LogFontSize) => void
  wrap: boolean
  onWrapToggle: () => void
  theme: LogDockTheme
  onThemeToggle: () => void
  searchOpen: boolean
  onSearchToggle: () => void
  onClear?: () => void
  /** When set, show a toolbar control to reconnect / refetch the log stream (e.g. Ludus range SSE). */
  onRefresh?: () => void
  refreshLoading?: boolean
  /** Content rendered on the left side (line count, live badge, mac dots, …). */
  leftSlot?: ReactNode
  sortOrder?: "asc" | "desc"
  onSortOrderToggle?: () => void
  className?: string
}

export interface LogDockSearchBarProps {
  searchQuery: string
  setSearchQuery: (q: string) => void
  matchIndices: number[]
  currentMatchIdx: number
  navigateMatch: (dir: 1 | -1) => void
  onClose: () => void
  searchInputRef: RefObject<HTMLInputElement>
  handleSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  theme: LogDockTheme
}

export function LogDockSearchBar({
  searchQuery,
  setSearchQuery,
  matchIndices,
  currentMatchIdx,
  navigateMatch,
  onClose,
  searchInputRef,
  handleSearchKeyDown,
  theme,
}: LogDockSearchBarProps) {
  const dark = theme === "dark"
  return (
    <div className={cn("px-3 pb-2 flex items-center gap-2", dark ? "bg-gray-900" : "bg-gray-100")}>
      <div className="relative flex-1">
        <input
          ref={searchInputRef}
          autoFocus
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search…"
          className={cn(
            "w-full text-xs font-mono px-2 py-1 rounded border focus:outline-none pr-6",
            dark
              ? "bg-gray-800 text-gray-200 border-gray-600 focus:border-gray-400"
              : "bg-white text-gray-800 border-gray-300 focus:border-gray-500",
          )}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(""); onClose() }}
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2",
              dark ? "text-gray-400 hover:text-gray-200" : "text-gray-400 hover:text-gray-700",
            )}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {searchQuery && (
        <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
          {matchIndices.length === 0 ? "No results" : `${currentMatchIdx + 1} / ${matchIndices.length}`}
        </span>
      )}
      <Button size="icon-sm" variant="ghost" onClick={() => navigateMatch(-1)} disabled={matchIndices.length === 0}>
        <ChevronUp className="h-3 w-3" />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => navigateMatch(1)} disabled={matchIndices.length === 0}>
        <ChevronDown className="h-3 w-3" />
      </Button>
    </div>
  )
}

export function LogDockToolbar({
  lines,
  downloadFilename = "log",
  paused,
  onPause,
  onResume,
  autoScroll,
  onAutoScrollToggle,
  showAutoScroll = true,
  fontSize,
  onFontSizeChange,
  wrap,
  onWrapToggle,
  theme,
  onThemeToggle,
  searchOpen,
  onSearchToggle,
  onClear,
  onRefresh,
  refreshLoading,
  leftSlot,
  sortOrder,
  onSortOrderToggle,
  className,
}: LogDockToolbarProps) {
  const dark = theme === "dark"

  const handleDownload = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${downloadFilename}-${new Date().toISOString().slice(0, 19)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(lines.join("\n")).catch(() => undefined)
  }

  const sizeIdx = LOG_FONT_SIZES.indexOf(fontSize)
  const canDecrease = sizeIdx > 0
  const canIncrease = sizeIdx < LOG_FONT_SIZES.length - 1

  const iconCls = dark ? "text-gray-400" : "text-gray-600"
  const activeCls = dark ? "text-yellow-400" : "text-yellow-600"

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-1.5 border-b",
        dark ? "bg-gray-900 border-gray-700" : "bg-gray-100 border-gray-200",
        className,
      )}
    >
      {/* Left slot: line count, live badge, mac dots, etc. */}
      <div className="flex items-center gap-2 min-w-0 text-xs font-mono truncate">
        {leftSlot}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* Pause / Resume */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={paused ? onResume : onPause}
          title={paused ? "Resume — show all buffered lines" : "Pause display (stream continues)"}
          className={paused ? activeCls : iconCls}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>

        {onRefresh && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={refreshLoading}
            title="Reconnect stream — reload output from server"
            className={iconCls}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshLoading && "animate-spin")} />
          </Button>
        )}

        {onSortOrderToggle && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onSortOrderToggle}
            title={sortOrder === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
            className={sortOrder === "desc" ? (dark ? "text-blue-400" : "text-blue-600") : iconCls}
          >
            {sortOrder === "desc" ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
          </Button>
        )}

        {/* Auto-scroll */}
        {showAutoScroll && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onAutoScrollToggle}
            title={autoScroll ? "Auto-scroll on — click to disable" : "Auto-scroll off — click to enable"}
            className={autoScroll ? (dark ? "text-green-400" : "text-green-600") : "text-muted-foreground/40"}
          >
            <ChevronsDown className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Font size stepper */}
        <div className="flex items-center gap-0.5 mx-0.5">
          <button
            onClick={() => canDecrease && onFontSizeChange(LOG_FONT_SIZES[sizeIdx - 1])}
            disabled={!canDecrease}
            title="Smaller text"
            className={cn(
              "rounded px-1 py-0.5 text-[10px] font-mono leading-none transition-colors",
              "hover:bg-accent hover:text-accent-foreground disabled:opacity-30",
              iconCls,
            )}
          >
            A−
          </button>
          <span className={cn("text-[10px] font-mono w-5 text-center", iconCls)}>{fontSize}</span>
          <button
            onClick={() => canIncrease && onFontSizeChange(LOG_FONT_SIZES[sizeIdx + 1])}
            disabled={!canIncrease}
            title="Larger text"
            className={cn(
              "rounded px-1 py-0.5 text-[10px] font-mono leading-none transition-colors",
              "hover:bg-accent hover:text-accent-foreground disabled:opacity-30",
              iconCls,
            )}
          >
            A+
          </button>
        </div>

        {/* Wrap */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onWrapToggle}
          title={wrap ? "Word wrap on — click to disable" : "Word wrap off — click to enable"}
          className={wrap ? (dark ? "text-blue-400" : "text-blue-600") : "text-muted-foreground/40"}
        >
          <WrapText className="h-3.5 w-3.5" />
        </Button>

        {/* Theme */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onThemeToggle}
          title={dark ? "Switch to light log theme" : "Switch to dark log theme"}
          className={iconCls}
        >
          {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>

        {/* Search */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onSearchToggle}
          title="Search"
          className={searchOpen ? activeCls : iconCls}
        >
          <Search className="h-3 w-3" />
        </Button>

        {/* Copy */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleCopy}
          disabled={lines.length === 0}
          title="Copy all to clipboard"
          className={iconCls}
        >
          <Copy className="h-3 w-3" />
        </Button>

        {/* Download */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleDownload}
          disabled={lines.length === 0}
          title="Download log file"
          className={iconCls}
        >
          <Download className="h-3 w-3" />
        </Button>

        {/* Clear (optional) */}
        {onClear && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClear}
            disabled={lines.length === 0}
            title="Clear logs"
            className={iconCls}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
