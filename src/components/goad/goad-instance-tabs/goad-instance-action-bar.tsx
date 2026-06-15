"use client"

import {
  CheckCircle2,
  HardDriveDownload,
  Loader2,
  MapPin,
  Power,
  PowerOff,
  Server,
  StopCircle,
  Trash2,
  Unlink,
  UserCog,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import type { GoadInstanceActionBarProps } from "./types"

export function GoadInstanceActionBar({
  instance,
  isAdmin,
  isRunning,
  isAborting,
  initializingRange,
  syncingIps,
  currentAction,
  rangeState,
  pendingAction,
  commitConfirm,
  cancelConfirm,
  onInstallProvideProvision,
  onProvide,
  onProvisionLab,
  onSyncIps,
  onStart,
  onStop,
  onStatus,
  onAbort,
  onOpenReassign,
  onDeleteInstanceOnly,
  onDestroy,
}: GoadInstanceActionBarProps) {
  const showAbort =
    isRunning || rangeState === "DEPLOYING" || rangeState === "WAITING" || isAborting

  return (
    <Card className="flex-shrink-0">
      <CardContent className="p-3 space-y-2">
        <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              className="bg-emerald-700 hover:bg-emerald-600 text-white"
              onClick={onInstallProvideProvision}
              disabled={isRunning || initializingRange || !!pendingAction}
              title="Provide then Provision lab in one GOAD session (full install)"
            >
              {(isRunning && currentAction === "install") || initializingRange ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <HardDriveDownload className="h-3.5 w-3.5" />
              )}
              {initializingRange ? "Creating range..." : "Install"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onProvide}
              disabled={isRunning || initializingRange || !!pendingAction}
              title="Deploy/update Ludus infrastructure (no Ansible). Creates a dedicated range if needed."
            >
              {(isRunning && currentAction === "provide") || initializingRange ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Server className="h-3.5 w-3.5" />
              )}
              {initializingRange ? "Creating range..." : "Provide"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onProvisionLab}
              disabled={isRunning || !!pendingAction}
              title="Run all Ansible playbooks to configure the lab"
            >
              {isRunning && currentAction === "provision-lab" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wrench className="h-3.5 w-3.5" />
              )}
              Provision Lab
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onSyncIps}
              disabled={isRunning || syncingIps || !!pendingAction || !instance.ludusRangeId}
              title={
                !instance.ludusRangeId
                  ? "No dedicated range yet — run Provide first"
                  : "Sync inventory files with the actual Ludus range IPs (use after a timed-out provide)"
              }
            >
              {syncingIps ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MapPin className="h-3.5 w-3.5" />
              )}
              Sync IPs
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onStart}
              disabled={isRunning || !!pendingAction}
              title="Power on all VMs"
            >
              {isRunning && currentAction === "start" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
              Start All
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={isRunning || !!pendingAction}
              title="Power off all VMs"
            >
              {isRunning && currentAction === "stop" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PowerOff className="h-3.5 w-3.5" />
              )}
              Stop All
            </Button>
            <Button size="sm" variant="outline" onClick={onStatus} disabled={isRunning || !!pendingAction}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Status
            </Button>
          </div>

          {showAbort && (
            <Button size="sm" variant="destructive" onClick={onAbort} disabled={isAborting}>
              {isAborting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <StopCircle className="h-3.5 w-3.5" />
              )}
              {isAborting ? "Aborting…" : "Abort"}
            </Button>
          )}

          <div className="flex-1" />

          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="border-blue-500/30 text-status-info hover:bg-status-info/10"
              onClick={onOpenReassign}
              disabled={isRunning || !!pendingAction}
              title="Re-assign this GOAD instance (and its range) to a different user"
            >
              <UserCog className="h-3.5 w-3.5" />
              Re-assign
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="border-status-warning/40 text-status-warning dark:text-status-warning hover:bg-status-warning/10"
            onClick={onDeleteInstanceOnly}
            disabled={isRunning || !!pendingAction}
            title="Remove GOAD workspace on the server; Ludus range and VMs are not deleted"
          >
            <Unlink className="h-3.5 w-3.5" />
            Delete Instance Only
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-status-error/30 text-status-error hover:bg-status-error/10"
            onClick={onDestroy}
            disabled={isRunning || !!pendingAction}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Instance + Range
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
