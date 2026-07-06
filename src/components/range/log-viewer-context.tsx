"use client"

import { createContext, useContext } from "react"
import type { LogFontSize, LogDockTheme } from "./log-dock-toolbar"

export interface LogViewerConfig {
  lines: string[]
  onClear?: () => void
  onRefresh?: () => void
  refreshLoading?: boolean
  autoScroll?: boolean
  className?: string
  maxHeight?: string
  live?: boolean
  liveLabel?: string
  downloadFilename?: string
  fillHeight?: boolean
  sortOrder?: "asc" | "desc"
  onSortOrderToggle?: () => void
  /** Allow the user to drag-resize the log body height. Defaults to `!fillHeight`. */
  resizable?: boolean
  /** localStorage key for persisting the dragged height (defaults to `downloadFilename`). */
  resizeKey?: string
  /** Minimum body height in px when resizable (default 140). */
  minHeight?: number
}

export interface LogViewerRuntime {
  containerRef: React.RefObject<HTMLDivElement | null>
  userScrolledAwayRef: React.MutableRefObject<boolean>
  prevScrollTopRef: React.MutableRefObject<number>
  prevLinesLenRef: React.MutableRefObject<number>
  showJumpBtn: boolean
  setShowJumpBtn: React.Dispatch<React.SetStateAction<boolean>>
  newestFirst: boolean
  localAutoScroll: boolean
  setLocalAutoScroll: React.Dispatch<React.SetStateAction<boolean>>
  fontSize: LogFontSize
  setFontSize: React.Dispatch<React.SetStateAction<LogFontSize>>
  wrap: boolean
  setWrap: React.Dispatch<React.SetStateAction<boolean>>
  theme: LogDockTheme
  setTheme: React.Dispatch<React.SetStateAction<LogDockTheme>>
  effectiveAutoScroll: boolean
  displayLines: string[]
  paused: boolean
  frozenAt: number
  pause: (at: number) => void
  resume: () => void
  visibleLines: string[]
  searchOpen: boolean
  searchQuery: string
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  currentMatchIdx: number
  matchIndices: number[]
  matchSet: Set<number>
  searchInputRef: React.RefObject<HTMLInputElement | null>
  matchLineRefsRef: React.MutableRefObject<Map<number, HTMLDivElement>>
  /** Body installs a virtualizer-backed scroll handler here when windowing is active. */
  scrollToMatchRef: React.MutableRefObject<((lineIdx: number) => void) | null>
  /** Body installs a virtualizer-backed "scroll to live edge" handler when windowing is active. */
  liveEdgeScrollRef: React.MutableRefObject<(() => void) | null>
  navigateMatch: (dir: 1 | -1) => void
  toggleSearch: () => void
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  scrollToLiveEdge: () => void
  handleScroll: () => void
  dark: boolean
  leftSlot: React.ReactNode
}

export type LogViewerContextValue = LogViewerConfig & LogViewerRuntime

const LogViewerContext = createContext<LogViewerContextValue | null>(null)

export function LogViewerProvider({
  value,
  children,
}: {
  value: LogViewerContextValue
  children: React.ReactNode
}) {
  return <LogViewerContext.Provider value={value}>{children}</LogViewerContext.Provider>
}

export function useLogViewer(): LogViewerContextValue {
  const ctx = useContext(LogViewerContext)
  if (!ctx) throw new Error("useLogViewer must be used within LogViewer.Root")
  return ctx
}
