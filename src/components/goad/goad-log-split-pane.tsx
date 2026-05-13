"use client"

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
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
      <div className={cn("flex flex-col gap-3 flex-1 min-h-0 w-full", className)}>
        <div className="flex flex-col flex-1 min-h-0">{left}</div>
        <div className="flex flex-col flex-1 min-h-0">{right}</div>
      </div>
    )
  }

  return (
    <ResizablePanelGroup
      autoSaveId={GOAD_LOG_SPLIT_AUTOSAVE_ID}
      direction="horizontal"
      className={cn("flex flex-1 min-h-0 w-full", className)}
    >
      <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
        {left}
      </ResizablePanel>
      <ResizableHandle withHandle className="w-2 shrink-0 bg-border/80 mx-0.5 rounded-sm max-w-[12px]" />
      <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 min-w-0">
        {right}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
