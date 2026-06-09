"use client"

import dynamic from "next/dynamic"
import { AlertTriangle, Check, Loader2, Server, Shield } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { GoadDeployTabProps } from "./types"

const GoadTerminal = dynamic(
  () => import("@/components/goad/goad-terminal").then((m) => ({ default: m.GoadTerminal })),
  { ssr: false },
)

const GoadLogSplitPane = dynamic(
  () => import("@/components/goad/goad-log-split-pane").then((m) => ({ default: m.GoadLogSplitPane })),
  { ssr: false },
)

export function GoadDeployTab({
  instance,
  instanceId,
  isRunning,
  isRangeStreaming,
  rangeState,
  currentAction,
  exitCode,
  lines,
  rangeLogLines,
  clear,
  clearRangeLogs,
  handleRefreshRangeLogs,
  rangeLogRefreshBusy,
  rangeElapsed,
  goadElapsed,
  postProcessingStep,
}: GoadDeployTabProps) {
  return (
    <TabsContent value="deploy" className="mt-4 flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="flex items-center gap-3 mb-3 flex-shrink-0 flex-wrap">
        {isRunning && currentAction && (
          <>
            <div className="h-2 w-2 rounded-full bg-status-success animate-pulse" />
            <span className="text-sm text-status-success">Running: {currentAction}</span>
          </>
        )}
        {instance.ludusRangeId && rangeState && (
          <Badge
            variant={
              rangeState === "SUCCESS"
                ? "success"
                : rangeState === "ERROR" || rangeState === "ABORTED"
                  ? "destructive"
                  : "warning"
            }
          >
            <Server className="h-3 w-3 mr-1" />
            Range: {rangeState}
          </Badge>
        )}
        {!instance.ludusRangeId && (
          <span className="text-xs text-status-warning">
            No dedicated range — click Provide to create one before provisioning.
          </span>
        )}
        {exitCode !== null && (
          <Badge variant={exitCode === 0 ? "success" : "destructive"}>
            GOAD {exitCode === 0 ? "Completed ✓" : `Failed (exit ${exitCode})`}
          </Badge>
        )}
        {lines.length === 0 && rangeLogLines.length === 0 && !isRunning && (
          <span className="text-xs text-muted-foreground">
            Use an action button above to start — output will appear here.
          </span>
        )}
      </div>

      {postProcessingStep !== "idle" && (
        <div className="mb-3 flex-shrink-0 flex items-center gap-2 rounded-lg border border-status-info/25 bg-status-info/5 px-3 py-2 text-xs">
          <Shield className="h-3.5 w-3.5 text-status-info shrink-0" />
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded border text-[11px]",
                postProcessingStep === "network-deploying"
                  ? "border-status-success/30 bg-status-success/10 text-status-success"
                  : "border-status-warning/30 bg-status-warning/10 text-status-warning",
              )}
            >
              {postProcessingStep === "network-deploying" ? (
                <Check className="h-2.5 w-2.5" />
              ) : (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              )}
              Step 1 — GOAD {postProcessingStep === "network-deploying" ? "done" : "running"}
            </span>
            <span className="text-muted-foreground/60">→</span>
            <span
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded border text-[11px]",
                postProcessingStep === "network-deploying"
                  ? "border-status-info/40 bg-status-info/10 text-status-info animate-pulse"
                  : "border-border/60 bg-muted/30 text-muted-foreground",
              )}
            >
              {postProcessingStep === "network-deploying" ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Shield className="h-2.5 w-2.5" />
              )}
              Step 2 — Firewall redeploy{" "}
              {postProcessingStep === "network-deploying" ? "running" : "pending"}
            </span>
          </div>
        </div>
      )}

      {!isRangeStreaming &&
        !isRunning &&
        (rangeState === "DEPLOYING" || rangeState === "WAITING") &&
        instance.ludusRangeId && (
          <Alert variant="destructive" className="mb-3 flex-shrink-0">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Range stuck in DEPLOYING.</strong> The Ludus deployment process appears to have
              finished without updating its state — a known Ludus issue after certain Ansible failures.
              Use the red <strong>Abort</strong> button in the top action bar (next to Status) to reset
              the range state so you can re-run Provide.
            </AlertDescription>
          </Alert>
        )}

      <GoadLogSplitPane
        className="flex-1 min-h-0 gap-3"
        left={
          <GoadTerminal
            lines={rangeLogLines}
            onClear={clearRangeLogs}
            onRefresh={instance.ludusRangeId ? handleRefreshRangeLogs : undefined}
            refreshLoading={rangeLogRefreshBusy}
            label={`Range Logs — ${instance.ludusRangeId ?? "no range"}${isRangeStreaming ? ` (live)${rangeElapsed ? ` · ${rangeElapsed}` : ""}` : rangeState ? ` · ${rangeState}` : ""}`}
            className="flex flex-col min-h-0 h-full"
          />
        }
        right={
          <GoadTerminal
            lines={lines}
            onClear={clear}
            label={`GOAD Logs — ${instanceId}${isRunning ? ` — ${currentAction ?? "running"}${goadElapsed ? ` · ${goadElapsed}` : ""}` : exitCode !== null ? ` · exit ${exitCode}` : ""}`}
            className="flex flex-col min-h-0 h-full"
          />
        }
      />
    </TabsContent>
  )
}
