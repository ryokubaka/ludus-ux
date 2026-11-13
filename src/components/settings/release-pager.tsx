"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RELEASE_PAGE_SIZE, releasePageRange } from "@/components/settings/release-page"

export function ReleasePager({
  page,
  count,
  onPage,
  pageSize = RELEASE_PAGE_SIZE,
  label = "releases",
}: {
  page: number
  count: number
  onPage: (page: number) => void
  pageSize?: number
  label?: string
}) {
  if (count <= pageSize) return null
  const range = releasePageRange(count, page, pageSize)
  return (
    <div
      className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2"
      role="navigation"
      aria-label={`${label} pages`}
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={range.page <= 0}
        onClick={() => onPage(range.page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Previous
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {range.from}–{range.to} of {count}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={range.page >= range.pages - 1}
        onClick={() => onPage(range.page + 1)}
        aria-label="Next page"
      >
        Next
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
