"use client"

import dynamic from "next/dynamic"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { TabsContent } from "@/components/ui/tabs"
import type { GoadTerminalTabProps } from "./types"

const GoadTerminal = dynamic(
  () => import("@/components/goad/goad-terminal").then((m) => ({ default: m.GoadTerminal })),
  { ssr: false },
)

export function GoadTerminalTab({
  active,
  instanceId,
  lines,
  isRunning,
  currentAction,
  taskId,
  exitCode,
  clear,
}: GoadTerminalTabProps) {
  return (
    <TabsContent value="terminal" className="mt-4 flex flex-col min-h-0 flex-1 overflow-hidden">
      {active ? (
        <>
          {lines.length === 0 && !isRunning && (
            <p className="text-xs text-muted-foreground mb-3 flex-shrink-0">
              Use the action buttons above to run GOAD commands. Output will appear here and persist if
              you navigate away.
            </p>
          )}
          <GoadTerminal
            lines={lines}
            onClear={clear}
            className="flex-1 flex flex-col min-h-0 w-full"
            label={`${instanceId} — ${currentAction ?? taskId ?? "terminal"}`}
          />
          {exitCode !== null && (
            <Alert
              variant={exitCode === 0 ? "success" : "destructive"}
              className="mt-3 flex-shrink-0"
            >
              <AlertDescription>
                Command exited with code {exitCode}
                {exitCode === 0 ? " ✓" : " ✗"}
              </AlertDescription>
            </Alert>
          )}
        </>
      ) : null}
    </TabsContent>
  )
}
