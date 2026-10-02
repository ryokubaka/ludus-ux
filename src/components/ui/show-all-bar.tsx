"use client"

import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

export const PREVIEW_COUNT = 6

export function previewSlice<T>(items: T[], expanded: boolean, preview = PREVIEW_COUNT): T[] {
  return expanded ? items : items.slice(0, preview)
}

/**
 * Footer for a truncated list.
 * A fade over the last row plus "Show N more" and "shown of total" makes it
 * obvious the list continues. The control is a bar, not another row label.
 */
export function ShowAllBar({
  expanded,
  count,
  preview = PREVIEW_COUNT,
  onToggle,
  className,
}: {
  expanded: boolean
  count: number
  preview?: number
  onToggle: () => void
  className?: string
}) {
  if (count <= preview) return null
  const hidden = Math.max(0, count - preview)
  const shown = expanded ? count : Math.min(preview, count)
  return (
    <div className="relative">
      {!expanded && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-full h-14 bg-gradient-to-t from-muted to-transparent"
        />
      )}
      <button
        type="button"
        aria-expanded={expanded}
        className={cn(
          "relative z-10 flex w-full items-center gap-2 border-t border-border bg-muted px-3 py-2.5 text-left text-xs font-medium text-foreground hover:bg-accent",
          className,
        )}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>{expanded ? "Show less" : `Show ${hidden} more`}</span>
        <span className="ml-auto tabular-nums font-normal text-muted-foreground">
          {shown} of {count}
        </span>
      </button>
    </div>
  )
}
