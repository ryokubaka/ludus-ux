"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { BadgeCheck, ChevronsDownUp, ChevronsUpDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/core/utils"

export function VersionLog({ text, label, onClose }: { text: string; label: string; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const body = useRef<HTMLPreElement>(null)
  const following = useRef(true)

  useLayoutEffect(() => {
    const pin = () => {
      const el = body.current
      if (!el || !following.current) return
      el.scrollTop = el.scrollHeight
    }
    pin()
    const frame = requestAnimationFrame(pin)
    return () => cancelAnimationFrame(frame)
  }, [text, expanded])

  function onScroll() {
    const el = body.current
    if (!el) return
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }

  return (
    <div className="m-4 overflow-hidden rounded-md border border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
            {expanded ? "Collapse" : "Expand"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7"
            aria-label={`Close ${label}`}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>
      <pre
        ref={body}
        onScroll={onScroll}
        className={cn(
          "resize-y overflow-auto overscroll-y-contain p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap",
          expanded ? "h-[min(70vh,40rem)]" : "h-64",
        )}
      >
        {text}
      </pre>
    </div>
  )
}

export function InstalledReleaseMark() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
      <BadgeCheck className="h-3 w-3" />
      This install
    </span>
  )
}

export function installedReleaseRowClass(installed: boolean): string {
  return installed ? "bg-primary/[0.07]" : ""
}
