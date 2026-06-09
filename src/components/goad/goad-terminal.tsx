"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import type { ReactNode } from "react"
import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isRecapStatsLine,
  parseRecapStats,
  getAnsibleLineClass,
  type AnsibleLogTheme,
} from "@/lib/ansible-colors"
import { splitLeadingWallTimestamp, stripStreamRolePrefix, LOG_PANE_WALL_CLOCK_CLASS } from "@/lib/log-line-timestamp"
import { appendStreamLines } from "@/lib/log-buffer"
import { usePauseAwareLines } from "@/components/range/use-pause-aware-lines"
import { useLogSearch } from "@/components/range/use-log-search"
import {
  LogDockToolbar,
  LogDockSearchBar,
  type LogDockTheme,
  type LogFontSize,
  DEFAULT_FONT_SIZE,
} from "@/components/range/log-dock-toolbar"

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
function renderRecapStats(line: string, logTheme: AnsibleLogTheme): ReactNode {
  return (
    <>
      {parseRecapStats(line, logTheme).map((seg, i) => (
        <span key={i} className={seg.cls}>{seg.text}</span>
      ))}
    </>
  )
}

// Colour class for all other lines (delegates to shared Ansible colour logic)
function getLineClass(line: string, logTheme: AnsibleLogTheme): string {
  if (line.startsWith("[TASKID]")) return "hidden"
  return getAnsibleLineClass(line, logTheme)
}

interface GoadTerminalProps {
  lines: string[]
  onClear?: () => void
  /** Reconnect range / deploy log SSE (shown in toolbar when set). */
  onRefresh?: () => void
  refreshLoading?: boolean
  className?: string
  label?: string
}

const BOTTOM_THRESHOLD = 80

export function GoadTerminal({ lines, onClear, onRefresh, refreshLoading, className, label }: GoadTerminalProps) {
  const containerRef        = useRef<HTMLDivElement>(null)
  const userScrolledUpRef   = useRef(false)
  const prevScrollTopRef    = useRef(0)
  const prevLinesLenRef     = useRef(0)
  const [showJumpBtn, setShowJumpBtn] = useState(false)

  // ── Toolbar state ─────────────────────────────────────────────────────────
  const [localAutoScroll, setLocalAutoScroll] = useState(true)
  const [fontSize, setFontSize] = useState<LogFontSize>(DEFAULT_FONT_SIZE)
  const [wrap, setWrap]         = useState(true)
  const [theme, setTheme]       = useState<LogDockTheme>("dark")

  // ── Pause ─────────────────────────────────────────────────────────────────
  const { displayLines, paused, frozenAt, pause, resume } = usePauseAwareLines(lines)

  // ── Search (search against ANSI-stripped text, operate on display view) ───
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
  } = useLogSearch(displayLines, { normalizeLine: stripAnsi })

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

    if (!localAutoScroll) {
      if (hasNew) setShowJumpBtn(true)
      return
    }

    if (!userScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight
      prevScrollTopRef.current = el.scrollTop
    } else if (hasNew) {
      setShowJumpBtn(true)
    }
  }, [displayLines, localAutoScroll])

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

  // ── Toolbar left slot: mac dots + label ───────────────────────────────────
  const dark = theme === "dark"
  const leftSlot = (
    <div className="flex items-center gap-2">
      <div className="flex gap-1.5 flex-shrink-0">
        <div className="w-3 h-3 rounded-full bg-red-500/80" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <div className="w-3 h-3 rounded-full bg-green-500/80" />
      </div>
      {paused ? (
        <span className="text-status-warning font-mono text-xs ml-1">
          Paused · {frozenAt} / {lines.length}
        </span>
      ) : (
        <span className={cn("text-xs font-mono ml-1", dark ? "text-muted-foreground" : "text-black")}>
          {label ?? "GOAD terminal"}
        </span>
      )}
    </div>
  )

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {/* Terminal header chrome */}
      <div className={cn(
        "border rounded-t-lg border-b-0 flex-shrink-0",
        dark ? "bg-black border-zinc-800" : "bg-card border-border",
      )}>
        <LogDockToolbar
          lines={lines}
          downloadFilename={`goad-${label ?? "terminal"}`}
          paused={paused}
          onPause={() => pause(lines.length)}
          onResume={() => { resume(); scrollToBottom() }}
          autoScroll={localAutoScroll}
          onAutoScrollToggle={() => setLocalAutoScroll(v => !v)}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          wrap={wrap}
          onWrapToggle={() => setWrap(v => !v)}
          theme={theme}
          onThemeToggle={() => setTheme(t => t === "dark" ? "light" : "dark")}
          searchOpen={searchOpen}
          onSearchToggle={toggleSearch}
          onClear={onClear ? () => { resume(); onClear() } : undefined}
          onRefresh={onRefresh}
          refreshLoading={refreshLoading}
          leftSlot={leftSlot}
          className="border-b-0 rounded-t-lg"
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
      </div>

      {/* Log body */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className={cn(
            "border rounded-b-lg p-4 font-mono overflow-y-auto min-h-[12rem] flex-1 min-w-0 w-full",
            dark ? "border-zinc-800 border-t-0" : "border-border",
            dark ? "bg-black text-gray-200" : "bg-gray-50 text-black",
            wrap ? "whitespace-pre-wrap break-words overflow-x-hidden" : "whitespace-pre overflow-x-auto",
          )}
          style={{ fontSize: `${fontSize}px`, lineHeight: "1.5" }}
        >
          {displayLines.length === 0 ? (
            <p className="italic text-gray-600">
              Waiting for output…
            </p>
          ) : (
            <div
              className={cn(
                "m-0 font-mono leading-relaxed min-w-0",
                // `<pre>` UA stylesheet uses white-space:pre and blocked parent pre-wrap; use a div so wrap matches LogViewer.
                wrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "whitespace-pre",
              )}
              style={{ fontSize: "inherit" }}
            >
              {displayLines.map((line, i) => {
                const clean = stripAnsi(line)
                if (!clean.trim()) return null

                const isMatch      = searchQuery.trim() !== "" && matchSet.has(i)
                const isCurrent    = isMatch && matchIndices[currentMatchIdx] === i
                const highlightCls = isCurrent ? "bg-status-warning/40" : isMatch ? "bg-status-warning/20" : ""
                const refCallback  = isMatch
                  ? (el: HTMLDivElement | null) => {
                      if (el) matchLineRefsRef.current.set(i, el)
                      else matchLineRefsRef.current.delete(i)
                    }
                  : undefined

                const isErrorRole = /^\[ERROR\]\s/.test(clean)
                if (isRecapStatsLine(clean)) {
                  const normalized = stripStreamRolePrefix(clean)
                  const { ts: wallTs, body } = splitLeadingWallTimestamp(normalized)
                  const recapLine = isRecapStatsLine(body) ? body : normalized
                  return (
                    <div key={i} ref={refCallback} className={cn(highlightCls, wrap && "min-w-0")}>
                      {wallTs ? (
                        <>
                          <span className={LOG_PANE_WALL_CLOCK_CLASS}>[{wallTs}]</span>
                          <span> </span>
                        </>
                      ) : null}
                      {renderRecapStats(recapLine, theme)}
                    </div>
                  )
                }
                const normalized = stripStreamRolePrefix(clean)
                const { ts: wallTs, body } = splitLeadingWallTimestamp(normalized)
                const bodyCls = isErrorRole ? "text-status-error" : getLineClass(body, theme)
                return (
                  <div key={i} ref={refCallback} className={cn(highlightCls, wrap && "min-w-0 break-words")}>
                    {wallTs ? (
                      <>
                        <span className={LOG_PANE_WALL_CLOCK_CLASS}>[{wallTs}]</span>
                        <span> </span>
                      </>
                    ) : null}
                    <span className={cn(bodyCls, "min-w-0")}>{body}</span>
                  </div>
                )
              })}
            </div>
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
 * Task IDs are stored server-side (goad_tasks SQLite table). The page-level
 * server-fallback effect in goad/[id]/page.tsx queries /api/goad/tasks on
 * mount to auto-resume any in-flight task, making GOAD logs visible across
 * browsers, incognito sessions, and admin impersonation without sessionStorage.
 */
export function useGoadStream(options?: UseGoadStreamOptions) {
  const [lines, setLines] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Task id for the active /api/goad/execute or …/stream connection — used to backfill exitCode from SQLite. */
  const streamTaskIdRef = useRef<string | null>(null)
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
    if (captureTaskId) {
      streamTaskIdRef.current = null
    }

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
          streamTaskIdRef.current = tid
          setTaskId(tid)
          return // hide [TASKID] lines from display
        }
        if (line.startsWith("[EXIT] ")) {
          const code = parseInt(line.match(/code (\d+)/)?.[1] || "0", 10)
          streamExit = Number.isNaN(code) ? null : code
          setExitCode(streamExit)
        }
        setLines((prev) => appendStreamLines(prev, line))
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
          // Trailing fragment after final chunk often has no closing "\n\n" — still dispatch.
          if (sseCarry.trim()) {
            for (const raw of sseCarry.split("\n")) {
              const t = raw.trim()
              if (!t) continue
              if (t.startsWith("data: ")) dispatchPayload(t.slice(6))
              else if (t.startsWith("data:")) dispatchPayload(t.slice(5))
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
        setLines((prev) => appendStreamLines(prev, `[ERROR] ${(err as Error).message}`))
      }
    } finally {
      setIsRunning(false)
      if (streamExit === null && streamTaskIdRef.current) {
        try {
          const tid = streamTaskIdRef.current
          const ex = getExtraHeadersRef.current?.() ?? {}
          const res = await fetch(`/api/goad/tasks/${encodeURIComponent(tid)}`, {
            credentials: "include",
            headers: { ...ex },
          })
          if (res.ok) {
            const task = (await res.json()) as { status?: string; exitCode?: number }
            if (task.status !== "running" && typeof task.exitCode === "number") {
              streamExit = task.exitCode
              setExitCode(task.exitCode)
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return streamExit
  }, [])

  const resumeTask = useCallback(async (tid: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    streamTaskIdRef.current = tid
    setTaskId(tid)

    return connectToStream(
      `/api/goad/tasks/${tid}/stream`,
      { signal: controller.signal },
      false
    )
  }, [connectToStream])

  const run = useCallback(async (
    args: string,
    instanceId?: string,
    /** apiKey is optional: when absent, the server uses the session cookie's impersonation key. */
    impersonateAs?: { username: string; apiKey?: string },
    /** Dedicated Ludus rangeID — injected as LUDUS_RANGE_ID so GOAD targets
     *  only this instance's range, leaving other ranges untouched. */
    rangeId?: string,
    /** Passed to Ludus wrapper as `--tags` on each `ludus range deploy` (allowlist server-side). */
    ludusDeployTags?: string[]
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
        body: JSON.stringify({
          args,
          instanceId,
          impersonateAs,
          rangeId,
          ...(ludusDeployTags && ludusDeployTags.length > 0 ? { ludusDeployTags } : {}),
        }),
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
    streamTaskIdRef.current = null
    setLines([])
    setExitCode(null)
    setTaskId(null)
    setIsRunning(false)
  }, [])

  return { lines, isRunning, exitCode, taskId, run, resumeTask, stop, clear }
}
