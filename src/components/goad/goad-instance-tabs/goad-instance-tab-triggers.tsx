"use client"

import { Activity, FileText, History, Puzzle, Server, Terminal } from "lucide-react"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { GoadInstanceTabTriggersProps } from "./types"

export function GoadInstanceTabTriggers({
  isRunning,
  isRangeStreaming,
  extensionCount,
  inventoryCount,
  onInventoriesOpen,
  onHistoryOpen,
}: GoadInstanceTabTriggersProps) {
  return (
    <TabsList>
      <TabsTrigger value="deploy">
        <Activity className="h-3.5 w-3.5 mr-1.5" />
        Deploy Status
        {(isRunning || isRangeStreaming) && (
          <span className="ml-1.5 h-2 w-2 rounded-full bg-status-success animate-pulse inline-block" />
        )}
      </TabsTrigger>
      <TabsTrigger value="terminal">
        <Terminal className="h-3.5 w-3.5 mr-1.5" />
        Terminal
      </TabsTrigger>
      <TabsTrigger value="info">
        <Server className="h-3.5 w-3.5 mr-1.5" />
        Lab Info
      </TabsTrigger>
      <TabsTrigger value="inventories" onClick={onInventoriesOpen}>
        <FileText className="h-3.5 w-3.5 mr-1.5" />
        Inventories
        {inventoryCount > 0 && (
          <span className="ml-1.5 text-muted-foreground">({inventoryCount})</span>
        )}
      </TabsTrigger>
      <TabsTrigger value="extensions">
        <Puzzle className="h-3.5 w-3.5 mr-1.5" />
        Extensions ({extensionCount})
      </TabsTrigger>
      <TabsTrigger value="history" onClick={onHistoryOpen}>
        <History className="h-3.5 w-3.5 mr-1.5" />
        Logs History
      </TabsTrigger>
    </TabsList>
  )
}
