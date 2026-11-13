"use client"

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { cn } from "@/lib/core/utils"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

/** Persists horizontal split ratio (localStorage via `autoSaveId`). */
export const GOAD_LOG_SPLIT_AUTOSAVE_ID = "lux-goad-log-split"

export function GoadLogSplitPane({
  left,
  right,
  className,
}: {
  left: ReactNode
  right: ReactNode
  className?: string
}) {
  const [wide, setWide] = useState<boolean | null>(null)

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const apply = () => setWide(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  if (wide !== true) {
    return (
      <div className={cn("flex h-full min-h-0 w-full flex-1 flex-col gap-3", className)}>
        <div className="flex min-h-0 flex-1 flex-col">{left}</div>
        <div className="flex min-h-0 flex-1 flex-col">{right}</div>
      </div>
    )
  }

  return (
    <ResizablePanelGroup
      autoSaveId={GOAD_LOG_SPLIT_AUTOSAVE_ID}
      direction="horizontal"
      className={cn("h-full min-h-0 w-full flex-1", className)}
    >
      <ResizablePanel defaultSize={50} minSize={20} className="h-full min-h-0 min-w-0">
        <div className="flex h-full min-h-0 flex-col">{left}</div>
      </ResizablePanel>
      <ResizableHandle withHandle className="mx-0.5 w-2 max-w-[12px] shrink-0 rounded-sm bg-border/80" />
      <ResizablePanel defaultSize={50} minSize={20} className="h-full min-h-0 min-w-0">
        <div className="flex h-full min-h-0 flex-col">{right}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
