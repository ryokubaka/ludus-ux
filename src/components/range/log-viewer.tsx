"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Trash2, Download, ArrowDown } from "lucide-react"
import { cn, parseLogLine } from "@/lib/utils"

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
  const containerRef = useRef<HTMLDivElement>(null)
  // true  = user has scrolled up and wants to read history; suppress auto-scroll
  // false = user is at (or near) the bottom; follow new lines automatically
  const userScrolledUpRef = useRef(false)
  const prevScrollTopRef  = useRef(0)
  const prevLinesLenRef   = useRef(0)
  const [showJumpBtn, setShowJumpBtn] = useState(false)

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

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-xs font-mono text-muted-foreground">
          {lines.length} lines
        </span>
        <div className="flex gap-1">
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
              const { color } = parseLogLine(rest)
              return (
                <div key={i} className="log-line whitespace-pre-wrap break-words flex gap-1.5">
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
                  <span className={color}>{rest}</span>
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
