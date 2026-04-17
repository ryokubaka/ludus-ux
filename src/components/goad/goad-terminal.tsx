"use client"

import { useEffect, useRef, useCallback, useState, useMemo } from "react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Download, Trash2, ArrowDown, Search, ChevronUp, ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { isRecapStatsLine, parseRecapStats, getAnsibleLineClass } from "@/lib/ansible-colors"

// Strip ANSI/VT100 codes so stored history with raw escape sequences renders cleanly.
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[^[\]]/g, "")
    .replace(/\x1b/g, "")
    .replace(/^.*\r(?!\n)/gm, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
}

// Render a PLAY RECAP stats line with per-stat colouring using shared utility
function renderRecapStats(line: string): ReactNode {
  return (
    <>
      {parseRecapStats(line).map((seg, i) => (
        <span key={i} className={seg.cls}>{seg.text}</span>
      ))}
    </>
  )
}

// Colour class for all other lines (delegates to shared Ansible colour logic)
function getLineClass(line: string): string {
  if (line.startsWith("[TASKID]")) return "hidden"
  return getAnsibleLineClass(line)
}

interface GoadTerminalProps {
  lines: string[]
  onClear?: () => void
  className?: string
  label?: string
}

const BOTTOM_THRESHOLD = 80 // px

export function GoadTerminal({ lines, onClear, className, label }: GoadTerminalProps) {
  const containerRef        = useRef<HTMLDivElement>(null)
  const userScrolledUpRef   = useRef(false)
  const prevScrollTopRef    = useRef(0)
  const prevLinesLenRef     = useRef(0)
  const [showJumpBtn, setShowJumpBtn] = useState(false)

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen]       = useState(false)
  const [searchQuery, setSearchQuery]     = useState("")
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0)
  const searchInputRef   = useRef<HTMLInputElement>(null)
  const matchLineRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())

  // Auto-scroll new lines into view
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const hasNew = lines.length > prevLinesLenRef.current
    prevLinesLenRef.current = lines.length

    if (lines.length === 0) {
      userScrolledUpRef.current = false
      prevScrollTopRef.current  = 0
      setShowJumpBtn(false)
      return
    }

    if (!userScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight
      prevScrollTopRef.current = el.scrollTop
    } else if (hasNew) {
      setShowJumpBtn(true)
    }
  }, [lines])

  // Reset search state when lines become empty
  useEffect(() => {
    if (lines.length === 0) {
      setSearchQuery("")
      setCurrentMatchIdx(0)
    }
  }, [lines])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return

    const isNearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD

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
    prevScrollTopRef.current  = el.scrollTop
    userScrolledUpRef.current = false
    setShowJumpBtn(false)
  }

  const downloadLog = () => {
    const content = lines.join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `goad-${new Date().toISOString().slice(0, 19)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Search logic ──────────────────────────────────────────────────────────

  const matchIndices = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    const result: number[] = []
    lines.forEach((line, i) => {
      if (stripAnsi(line).toLowerCase().includes(q)) result.push(i)
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
    <div className={cn("flex flex-col min-h-0", className)}>
      {/* ── Terminal header ── */}
      <div className="bg-gray-900 border border-gray-700 rounded-t-lg border-b-0 flex-shrink-0">
        {/* Top toolbar row */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-gray-400 font-mono ml-2">{label ?? "GOAD terminal"}</span>
          </div>
          <div className="flex gap-1 items-center">
            <Button size="icon-sm" variant="ghost" onClick={toggleSearch}>
              <Search className={cn("h-3 w-3", searchOpen ? "text-yellow-400" : "text-gray-400")} />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={downloadLog} disabled={lines.length === 0}>
              <Download className="h-3 w-3 text-gray-400" />
            </Button>
            {onClear && (
              <Button size="icon-sm" variant="ghost" onClick={onClear} disabled={lines.length === 0}>
                <Trash2 className="h-3 w-3 text-gray-400" />
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
                className="w-full bg-gray-800 text-gray-200 text-xs font-mono px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-gray-400 pr-6"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchOpen(false) }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
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
              <ChevronUp className="h-3 w-3 text-gray-400" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => navigateMatch(1)}
              disabled={matchIndices.length === 0}
            >
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </Button>
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="bg-gray-950 border border-gray-700 rounded-b-lg p-4 font-mono text-xs overflow-y-auto overflow-x-hidden min-h-[12rem] flex-1"
        >
          {lines.length === 0 ? (
            <p className="text-gray-600 italic">Waiting for output...</p>
          ) : (
            <pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {lines.map((line, i) => {
                const clean = stripAnsi(line)
                if (!clean.trim()) return null

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

                if (isRecapStatsLine(clean)) {
                  return (
                    <div key={i} ref={refCallback} className={highlightCls}>
                      {renderRecapStats(clean)}
                    </div>
                  )
                }
                return (
                  <div key={i} ref={refCallback} className={cn(getLineClass(clean), highlightCls)}>
                    {clean}
                  </div>
                )
              })}
            </pre>
          )}
        </div>

        {showJumpBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full
                       bg-gray-700/90 text-gray-200 text-xs font-mono shadow-lg
                       hover:bg-gray-600 transition-colors z-10"
          >
            <ArrowDown className="h-3 w-3" />
            new output
          </button>
        )}
      </div>
    </div>
  )
}

// ── useGoadStream ─────────────────────────────────────────────────────────────

export type UseGoadStreamOptions = {
  /** Same headers as other LUX API calls (e.g. impersonation) — required for GET /tasks/:id + resume SSE. */
  getExtraHeaders?: () => Record<string, string>
}

/**
 * Hook for streaming GOAD command output via SSE.
 * Persists the active task ID in sessionStorage (keyed by storageKey) so that
 * switching pages and coming back can resume from the server-side task store.
 */
export function useGoadStream(storageKey?: string, options?: UseGoadStreamOptions) {
  const [lines, setLines] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const getExtraHeadersRef = useRef(options?.getExtraHeaders)
  getExtraHeadersRef.current = options?.getExtraHeaders

  const connectToStream = useCallback(async (
    url: string,
    fetchOptions: RequestInit,
    captureTaskId: boolean
  ): Promise<number | null> => {
    setLines([])
    setExitCode(null)
    setIsRunning(true)
    let streamExit: number | null = null

    const extra = getExtraHeadersRef.current?.() ?? {}
    const merged = new Headers()
    for (const [k, v] of Object.entries(extra)) {
      if (v) merged.set(k, v)
    }
    if (fetchOptions.headers) {
      const inner = new Headers(fetchOptions.headers as HeadersInit)
      inner.forEach((v, k) => merged.set(k, v))
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: merged,
        credentials: "include",
      })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      /** Accumulate bytes until SSE double-newline so chunk splits never drop `data:` lines. */
      let sseCarry = ""

      const dispatchPayload = (line: string) => {
        // Capture task ID emitted by the execute route
        if (captureTaskId && line.startsWith("[TASKID] ")) {
          const tid = line.slice(9).trim()
          setTaskId(tid)
          if (storageKey) sessionStorage.setItem(storageKey, tid)
          return // hide [TASKID] lines from display
        }
        if (line.startsWith("[EXIT] ")) {
          const code = parseInt(line.match(/code (\d+)/)?.[1] || "0", 10)
          streamExit = Number.isNaN(code) ? null : code
          setExitCode(streamExit)
        }
        setLines((prev) => [...prev, line])
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          sseCarry += decoder.decode()
          if (sseCarry.includes("\n\n")) {
            const tailBlocks = sseCarry.split("\n\n")
            sseCarry = tailBlocks.pop() ?? ""
            for (const block of tailBlocks) {
              for (const raw of block.split("\n")) {
                if (raw.startsWith("data: ")) dispatchPayload(raw.slice(6))
                else if (raw.startsWith("data:")) dispatchPayload(raw.slice(5))
              }
            }
          }
          break
        }

        sseCarry += decoder.decode(value, { stream: true })
        const blocks = sseCarry.split("\n\n")
        sseCarry = blocks.pop() ?? ""
        for (const block of blocks) {
          for (const raw of block.split("\n")) {
            if (raw.startsWith("data: ")) dispatchPayload(raw.slice(6))
            else if (raw.startsWith("data:")) dispatchPayload(raw.slice(5))
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setLines((prev) => [...prev, `[ERROR] ${(err as Error).message}`])
      }
    } finally {
      setIsRunning(false)
    }
    return streamExit
  }, [storageKey])

  const resumeTask = useCallback(async (tid: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setTaskId(tid)

    return connectToStream(
      `/api/goad/tasks/${tid}/stream`,
      { signal: controller.signal },
      false
    )
  }, [connectToStream])

  // After navigate away/back: reconnect to SSE — replays log file + live buffer.
  // Always call resume when a task id is saved; optional GET is best-effort (must
  // send impersonation headers or ownership checks can 404 and we used to skip resume).
  useEffect(() => {
    if (!storageKey) return
    const savedTaskId = sessionStorage.getItem(storageKey)
    if (!savedTaskId) return

    let cancelled = false
    void (async () => {
      const extra = getExtraHeadersRef.current?.() ?? {}
      try {
        await fetch(`/api/goad/tasks/${savedTaskId}`, {
          credentials: "include",
          headers: { ...extra },
        })
      } catch {
        /* non-fatal — stream may still work */
      }
      if (cancelled) return
      await resumeTask(savedTaskId)
    })()

    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [storageKey, resumeTask])

  const run = useCallback(async (
    args: string,
    instanceId?: string,
    impersonateAs?: { username: string; apiKey: string },
    /** Dedicated Ludus rangeID — injected as LUDUS_RANGE_ID so GOAD targets
     *  only this instance's range, leaving other ranges untouched. */
    rangeId?: string
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setTaskId(null)

    return connectToStream(
      "/api/goad/execute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args, instanceId, impersonateAs, rangeId }),
        signal: controller.signal,
      },
      true
    )
  }, [connectToStream])

  const stop = useCallback(async () => {
    // Capture current taskId before any state updates
    const tid = taskId
    if (tid) {
      // Ask the server to kill the SSH/ansible process. This works even when
      // the original SSE connection (execute route) has already disconnected,
      // e.g. after sign-out/back-in + resume.
      try {
        const extra = getExtraHeadersRef.current?.() ?? {}
        await fetch(`/api/goad/tasks/${tid}/stop`, {
          method: "POST",
          credentials: "include",
          headers: { ...extra },
        })
      } catch {
        // Best-effort; continue to tear down the client side regardless
      }
    }
    abortRef.current?.abort()
    setIsRunning(false)
  }, [taskId])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setLines([])
    setExitCode(null)
    setTaskId(null)
    setIsRunning(false)
    if (storageKey) sessionStorage.removeItem(storageKey)
  }, [storageKey])

  return { lines, isRunning, exitCode, taskId, run, resumeTask, stop, clear }
}
