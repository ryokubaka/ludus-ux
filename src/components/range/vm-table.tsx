"use client"

import { Fragment, useEffect, useState, useMemo, useCallback, memo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Monitor, Power, PowerOff, RotateCw, Circle, Download, MonitorPlay, Loader2, ExternalLink, Trash2, AlertTriangle, RefreshCw, ArrowDown, ArrowUp } from "lucide-react"
import { vmIdentityKey } from "@/lib/ui/dashboard-vm-merge"
import {
  compareVmRows,
  defaultDirForVmSort,
  DEFAULT_VM_SORT,
  type VmSort,
  type VmSortKey,
} from "@/components/range/vm-table-sort"
import type { VMObject } from "@/lib/core/types"
import { cn } from "@/lib/core/utils"
import { ludusApi, postVmOperationAudit, pruneKnownHosts } from "@/lib/ui/api"
import { vmDisplayName, restartRangeVms, waitForVmPowerConfirmation } from "@/lib/proxmox/wait-for-vm-power-state"
import { isLudusAwaitResponseTimeoutMessage, tryToastLudusSlowHttpError } from "@/lib/ludus/ludus-timeout-ui"
import { useToast } from "@/hooks/use-toast"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"

interface VMTableProps {
  vms: VMObject[]
  onRefresh?: () => void
  /** When set, Ludus DELETE /vm/{id} is scoped to this range */
  rangeId?: string
  /** If provided, a "Browser" console button is shown per VM (opens in same tab) */
  onOpenBrowser?: (vm: VMObject) => void
  /** If provided, a popout button opens the console in a new window */
  onOpenBrowserNewWindow?: (vm: VMObject) => void
  /** If provided, a ".vv" download button is shown per VM */
  onDownloadVv?: (vm: VMObject) => void
  downloadingVm?: string | null
  openingVm?: string | null
  /**
   * Explicit data state. Omit to preserve the legacy behavior (empty table when
   * `vms` is empty). The dashboard passes loading/error so a failed poll is not
   * rendered as "No VMs deployed yet".
   */
  state?: "loading" | "error" | "empty" | "ready"
  /** Human-readable failure for `state: "error"`. */
  errorMessage?: string | null
  /** Retry action shown in the error state. */
  onRetry?: () => void
  /** Identity keys of rows retained from a previous poll; rendered as unconfirmed. */
  unconfirmedVmKeys?: readonly string[]
}

interface VMTableRowProps {
  vm: VMObject
  name: string
  running: boolean
  selected: boolean
  powerLoading: boolean
  powerLocked: boolean
  pendingAction: "on" | "off" | "restart" | undefined
  isDownloading: boolean
  isOpening: boolean
  isDestroying: boolean
  showConsole: boolean
  unconfirmed: boolean
  onToggleSelect: (name: string) => void
  onPower: (names: string[], action: "on" | "off" | "restart") => void
  onDestroy: (vm: VMObject) => void
  onOpenBrowser?: (vm: VMObject) => void
  onOpenBrowserNewWindow?: (vm: VMObject) => void
  onDownloadVv?: (vm: VMObject) => void
}

const VMTableRow = memo(function VMTableRow({
  vm,
  name,
  running,
  selected,
  powerLoading,
  powerLocked,
  pendingAction,
  isDownloading,
  isOpening,
  isDestroying,
  showConsole,
  unconfirmed,
  onToggleSelect,
  onPower,
  onDestroy,
  onOpenBrowser,
  onOpenBrowserNewWindow,
  onDownloadVv,
}: VMTableRowProps) {
  return (
    <tr
      aria-label={`VM ${name}, ${running ? "running" : "stopped"}${unconfirmed ? ", unconfirmed" : ""}`}
      className={cn(
        "border-b border-border/50 hover:bg-muted/30 transition-colors",
        selected && "bg-primary/5"
      )}
    >
      <td className="w-10 px-3 py-2 align-middle">
        <Checkbox
          aria-label={`Select ${name}`}
          checked={selected}
          onCheckedChange={() => onToggleSelect(name)}
        />
      </td>
      <td className="px-3 py-2 align-middle min-w-0">
        <div className="flex items-center gap-2 min-w-0">
        <Monitor className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-mono text-xs font-medium truncate">{name}</span>
        {unconfirmed && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-status-warning border-status-warning/40 shrink-0">
            unconfirmed
          </Badge>
        )}
        </div>
      </td>
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {powerLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-status-warning" />
              <span className="text-xs text-status-warning">
                {pendingAction === "on" ? "Starting…" : pendingAction === "restart" ? "Restarting…" : "Stopping…"}
              </span>
            </>
          ) : (
            <>
              <Circle className={cn("h-2 w-2 fill-current", running ? "text-status-success" : "text-status-error")} />
              <span className={cn("text-xs", running ? "text-status-success" : "text-status-error")}>
                {running ? "Running" : "Stopped"}
              </span>
            </>
          )}
        </div>
      </td>
      <td className="hidden md:table-cell px-3 py-2 align-middle whitespace-nowrap">
        <span className="font-mono text-xs text-muted-foreground truncate">
          {vm.ip && vm.ip !== "null" ? vm.ip : "—"}
        </span>
      </td>
      <td className="hidden md:table-cell px-3 py-2 align-middle whitespace-nowrap">
        <span className="font-mono text-xs text-muted-foreground">{vm.proxmoxID || vm.ID}</span>
      </td>
      {showConsole && (
        <td className="hidden md:table-cell px-3 py-2 align-middle">
          <div className="flex items-center justify-center gap-0.5">
          {onOpenBrowser && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm" variant="ghost"
                  disabled={!running || isOpening}
                  aria-label={`Open console for ${name}`}
                  className={cn(!running && "opacity-30")}
                  onClick={() => onOpenBrowser(vm)}
                >
                  {isOpening
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <MonitorPlay className="h-3 w-3 text-primary" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{running ? "Browser console (noVNC)" : "Power on first"}</TooltipContent>
            </Tooltip>
          )}
          {onOpenBrowserNewWindow && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm" variant="ghost"
                  disabled={!running}
                  aria-label={`Open console for ${name} in a new window`}
                  className={cn(!running && "opacity-30")}
                  onClick={() => onOpenBrowserNewWindow(vm)}
                >
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{running ? "Open console in new window" : "Power on first"}</TooltipContent>
            </Tooltip>
          )}
          {onDownloadVv && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm" variant="ghost"
                  disabled={!running || isDownloading}
                  aria-label={`Download ${name} .vv file`}
                  className={cn(!running && "opacity-30")}
                  onClick={() => onDownloadVv(vm)}
                >
                  {isDownloading
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Download className="h-3 w-3 text-primary" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{running ? "Download .vv (virt-viewer / SPICE)" : "Power on first"}</TooltipContent>
            </Tooltip>
          )}
          </div>
        </td>
      )}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <div className="flex items-center justify-end gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost"
              disabled={powerLoading || powerLocked || running}
              aria-label={`Power on ${name}`}
              onClick={() => onPower([name], "on")}>
              {powerLoading && pendingAction === "on"
                ? <Loader2 className="h-3 w-3 animate-spin text-status-success" />
                : <Power className="h-3 w-3 text-status-success" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Power On</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost"
              disabled={powerLoading || powerLocked || !running}
              aria-label={`Restart ${name}`}
              onClick={() => onPower([name], "restart")}>
              {powerLoading && pendingAction === "restart"
                ? <Loader2 className="h-3 w-3 animate-spin text-status-info" />
                : <RotateCw className="h-3 w-3 text-status-info" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{running ? "Restart" : "Power on first"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost"
              disabled={powerLoading || powerLocked || !running}
              aria-label={`Power off ${name}`}
              onClick={() => onPower([name], "off")}>
              {powerLoading && pendingAction === "off"
                ? <Loader2 className="h-3 w-3 animate-spin text-status-error" />
                : <PowerOff className="h-3 w-3 text-status-error" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Power Off</TooltipContent>
        </Tooltip>
        </div>
      </td>
      <td className="w-14 px-3 py-2 align-middle text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={powerLoading || isDestroying}
              aria-label={`Destroy ${name}`}
              onClick={() => void onDestroy(vm)}
            >
              {isDestroying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Destroy VM (permanent)</TooltipContent>
        </Tooltip>
      </td>
    </tr>
  )
})

function SortHeader({
  label,
  column,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string
  column: VmSortKey
  sort: VmSort
  onSort: (column: VmSortKey) => void
  align?: "left" | "right"
  className?: string
}) {
  const active = sort.key === column
  const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2", align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {active ? <Icon className="h-3 w-3" aria-hidden="true" /> : <span className="h-3 w-3" aria-hidden="true" />}
      </button>
    </th>
  )
}

function VMTableHeader({
  showConsole,
  allSelected,
  someSelected,
  onToggleSelectAll,
  sort,
  onSort,
}: {
  showConsole: boolean
  allSelected: boolean
  someSelected: boolean
  onToggleSelectAll: () => void
  sort: VmSort
  onSort: (column: VmSortKey) => void
}) {
  const plain = "px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
  return (
    <tr className="bg-muted/50 border-b border-border">
      <th scope="col" className="w-10 px-3 py-2">
        <Checkbox
          aria-label="Select all VMs"
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={onToggleSelectAll}
        />
      </th>
      <SortHeader label="VM Name" column="name" sort={sort} onSort={onSort} className="text-left" />
      <SortHeader label="Status" column="status" sort={sort} onSort={onSort} />
      <SortHeader label="IP" column="ip" sort={sort} onSort={onSort} className="hidden md:table-cell" />
      <SortHeader label="VMID" column="vmid" sort={sort} onSort={onSort} className="hidden md:table-cell" />
      {showConsole && (
        <th scope="col" className={cn("hidden md:table-cell text-center", plain)}>Console</th>
      )}
      <th scope="col" className={cn("text-right", plain)}>Power</th>
      <th scope="col" className={cn("w-14 text-center", plain)}>Destroy</th>
    </tr>
  )
}

function SkeletonRows({ rows = 5, showConsole }: { rows?: number; showConsole: boolean }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="border-b border-border/50" aria-hidden="true">
          <td className="px-3 py-2"><Skeleton className="h-4 w-4" /></td>
          <td className="px-3 py-2"><Skeleton className="h-3.5 w-40 max-w-full" /></td>
          <td className="px-3 py-2"><Skeleton className="h-3 w-14" /></td>
          <td className="hidden md:table-cell px-3 py-2"><Skeleton className="h-3 w-20" /></td>
          <td className="hidden md:table-cell px-3 py-2"><Skeleton className="h-3 w-8" /></td>
          {showConsole && <td className="hidden md:table-cell px-3 py-2"><Skeleton className="h-6 w-16 mx-auto" /></td>}
          <td className="px-3 py-2"><Skeleton className="h-6 w-20 ml-auto" /></td>
          <td className="px-3 py-2"><Skeleton className="h-6 w-6 mx-auto" /></td>
        </tr>
      ))}
    </>
  )
}

/** Above this many rows, render only the rows in view. */
const VIRTUALIZE_THRESHOLD = 100

export function VMTable({
  vms,
  onRefresh,
  rangeId,
  onOpenBrowser,
  onOpenBrowserNewWindow,
  onDownloadVv,
  downloadingVm,
  openingVm,
  state,
  errorMessage,
  onRetry,
  unconfirmedVmKeys,
}: VMTableProps) {
  const { toast } = useToast()
  const { pendingAction: pendingConfirm, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set())
  const [loadingVMs, setLoadingVMs] = useState<Set<string>>(new Set())
  const [pendingPowerAction, setPendingPowerAction] = useState<Map<string, "on" | "off" | "restart">>(new Map())
  const [destroyingProxmoxId, setDestroyingProxmoxId] = useState<number | null>(null)
  const [pendingDestroy, setPendingDestroy] = useState<VMObject | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const vmName = vmDisplayName
  const isRunning = (vm: VMObject) => vm.poweredOn ?? (vm.powerState === "running")
  const showConsole = !!(onOpenBrowser || onOpenBrowserNewWindow || onDownloadVv)
  const tableState = state ?? (vms.length === 0 ? "empty" : "ready")
  const unconfirmedKeys = useMemo(
    () => new Set(unconfirmedVmKeys ?? []),
    [unconfirmedVmKeys],
  )

  const toggleSelect = useCallback((name: string) => {
    setSelectedVMs((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const toggleSelectAll = () => {
    if (selectedVMs.size === vms.length) {
      setSelectedVMs(new Set())
    } else {
      setSelectedVMs(new Set(vms.map(vmName)))
    }
  }

  const clearPendingPower = useCallback((names: string[]) => {
    setLoadingVMs((prev) => {
      const next = new Set(prev)
      names.forEach((n) => next.delete(n))
      return next
    })
    setPendingPowerAction((prev) => {
      const next = new Map(prev)
      names.forEach((n) => next.delete(n))
      return next
    })
  }, [])

  const handlePower = useCallback(async (names: string[], action: "on" | "off" | "restart") => {
    setLoadingVMs((prev) => new Set([...Array.from(prev), ...names]))
    setPendingPowerAction((prev) => {
      const next = new Map(prev)
      names.forEach((n) => next.set(n, action))
      return next
    })
    let pollAfterRequest = false
    try {
      if (action === "restart") {
        toast({
          title: "Restarting",
          description: `${names.length} VM(s) will power off, then power back on.`,
        })
        const restarted = await restartRangeVms({
          rangeId,
          vmNames: names,
          continueAfterError: isLudusAwaitResponseTimeoutMessage,
          powerOff: async () => {
            const result = await ludusApi.powerOff(names, rangeId)
            if (result.error && isLudusAwaitResponseTimeoutMessage(result.error)) {
              tryToastLudusSlowHttpError({
                toast,
                error: result.error,
                slowTitle: "Slow response from Ludus",
                onSlow: () => onRefresh?.(),
              })
            }
            return result
          },
          powerOn: async () => {
            const result = await ludusApi.powerOn(names, rangeId)
            if (result.error && isLudusAwaitResponseTimeoutMessage(result.error)) {
              tryToastLudusSlowHttpError({
                toast,
                error: result.error,
                slowTitle: "Slow response from Ludus",
                onSlow: () => onRefresh?.(),
              })
            }
            return result
          },
          fetchStatus: () => ludusApi.getRangeStatus(rangeId),
        })
        onRefresh?.()
        if (restarted.ok) {
          toast({ title: "Restart confirmed", description: `${names.length} VM(s) running` })
        } else if ("error" in restarted) {
          toast({ variant: "destructive", title: "Restart failed", description: restarted.error })
        } else if (restarted.via === "timeout") {
          toast({
            variant: "destructive",
            title: "Restart not confirmed yet",
            description: `${restarted.pending.length} VM(s) may still be ${restarted.phase === "off" ? "stopping" : "starting"}. Refresh to check.`,
          })
        }
        return
      }
      // Scope to the current range so Ludus does not fall back to the user's
      // default range — which breaks (or targets the wrong range) whenever the
      // dashboard is showing a non-default or GOAD-mapped range. Without this,
      // Ludus returns `Range <id> not found for user <user>`.
      const result = action === "on"
        ? await ludusApi.powerOn(names, rangeId)
        : await ludusApi.powerOff(names, rangeId)
      if (result.error) {
        if (
          tryToastLudusSlowHttpError({
            toast,
            error: result.error,
            slowTitle: "Slow response from Ludus",
            onSlow: () => onRefresh?.(),
          })
        ) {
          pollAfterRequest = true
        } else {
          toast({ variant: "destructive", title: "Error", description: result.error })
          return
        }
      } else {
        toast({
          title: action === "on" ? "Powering on" : "Powering off",
          description: `${names.length} VM(s) — waiting for confirmation…`,
        })
        pollAfterRequest = true
      }

      if (pollAfterRequest) {
        onRefresh?.()
        const wait = await waitForVmPowerConfirmation({
          rangeId,
          vmNames: names,
          action,
          fetchStatus: () => ludusApi.getRangeStatus(rangeId),
        })
        onRefresh?.()
        if (wait.ok) {
          toast({
            title: action === "on" ? "Power on confirmed" : "Power off confirmed",
            description: `${names.length} VM(s)`,
          })
        } else if (wait.via === "timeout") {
          toast({
            variant: "destructive",
            title: "Power state not confirmed yet",
            description:
              wait.pending.length === 1
                ? `${wait.pending[0]} may still be ${action === "on" ? "starting" : "stopping"}. Refresh to check.`
                : `${wait.pending.length} VM(s) may still be ${action === "on" ? "starting" : "stopping"}. Refresh to check.`,
          })
        }
      }
    } finally {
      clearPendingPower(names)
    }
  }, [rangeId, onRefresh, toast, clearPendingPower])

  // Parent range polls can confirm power before our waiter finishes — drop spinners early.
  useEffect(() => {
    if (pendingPowerAction.size === 0) return
    const confirmed: string[] = []
    for (const [name, action] of pendingPowerAction) {
      const vm = vms.find((v) => vmName(v) === name)
      if (!vm) continue
      if (action === "restart") continue
      const running = isRunning(vm)
      const matches = action === "on" ? running : !running
      if (matches) confirmed.push(name)
    }
    if (confirmed.length > 0) clearPendingPower(confirmed)
  }, [vms, pendingPowerAction])

  const confirmDestroy = useCallback(async () => {
    const vm = pendingDestroy
    if (!vm) return
    setPendingDestroy(null)
    const name = vmName(vm)
    const proxmoxId = vm.proxmoxID ?? vm.ID
    setDestroyingProxmoxId(proxmoxId)
    const result = await ludusApi.destroyVm(proxmoxId, rangeId)
    if (result.error) {
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: result.error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => onRefresh?.(),
        })
      ) {
        /* destroy may still be queued */
      } else {
        toast({ variant: "destructive", title: "Destroy failed", description: result.error })
        void postVmOperationAudit({
          kind: "destroy_vm",
          rangeId,
          vmId: proxmoxId,
          vmName: name,
          status: "error",
          detail: result.error,
        })
      }
    } else {
      toast({
        title: "VM destroyed",
        description: result.data?.result ?? `${name} removed from range`,
      })
      void postVmOperationAudit({
        kind: "destroy_vm",
        rangeId,
        vmId: proxmoxId,
        vmName: name,
        status: "ok",
        detail: result.data?.result,
      })
      const ip = typeof vm.ip === "string" ? vm.ip.trim() : ""
      if (ip) void pruneKnownHosts([ip])
      setSelectedVMs((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
      onRefresh?.()
    }
    setDestroyingProxmoxId(null)
  }, [pendingDestroy, rangeId, onRefresh, toast, vmName])

  const askPower = useCallback((names: string[], action: "on" | "off" | "restart", where: "row" | "selected") => {
    if (names.length === 0) return
    const target = names.length === 1 && where === "row"
      ? names[0]
      : `${names.length} selected VM${names.length === 1 ? "" : "s"}`
    const label = action === "restart"
      ? `Restart ${target}? ${names.length === 1 ? "It powers" : "They power"} off, then back on.`
      : action === "on"
        ? `Power on ${target}?`
        : `Power off ${target}?`
    confirm(label, () => { void handlePower(names, action) }, where === "row" ? `power:${names[0]}` : "power:selected")
  }, [confirm, handlePower])

  const askRowPower = useCallback((names: string[], action: "on" | "off" | "restart") => {
    askPower(names, action, "row")
  }, [askPower])

  const selectedArray = Array.from(selectedVMs)
  const [sort, setSort] = useState<VmSort>(DEFAULT_VM_SORT)
  const onSort = useCallback((column: VmSortKey) => {
    setSort((prev) => (
      prev.key === column
        ? { key: column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: column, dir: defaultDirForVmSort(column) }
    ))
  }, [])

  const sortedVms = useMemo(
    () => [...vms].sort((a, b) => compareVmRows(
      a,
      b,
      sort,
      vmName,
      (vm) => vm.poweredOn ?? (vm.powerState === "running"),
    )),
    [vms, vmName, sort],
  )
  const columnCount = showConsole ? 8 : 7

  const virtualize = tableState === "ready" && sortedVms.length > VIRTUALIZE_THRESHOLD
  const rowVirtualizer = useVirtualizer({
    count: sortedVms.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 49,
    overscan: 10,
    enabled: virtualize,
  })
  const virtualItems = virtualize ? rowVirtualizer.getVirtualItems() : []
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0
  const paddingBottom = virtualItems.length > 0
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
    : 0
  const visibleVms = virtualize
    ? virtualItems.flatMap((item) => {
        const vm = sortedVms[item.index]
        return vm ? [vm] : []
      })
    : sortedVms

  const renderRow = (vm: VMObject) => {
    const name = vmName(vm)
    const proxmoxId = vm.proxmoxID ?? vm.ID
    const scope = `power:${name}`
    return (
      <Fragment key={vmIdentityKey(vm)}>
        <VMTableRow
          vm={vm}
          name={name}
          running={isRunning(vm)}
          selected={selectedVMs.has(name)}
          powerLoading={loadingVMs.has(name)}
          powerLocked={!!pendingConfirm}
          pendingAction={pendingPowerAction.get(name)}
          isDownloading={downloadingVm === name}
          isOpening={openingVm === name}
          isDestroying={destroyingProxmoxId === proxmoxId}
          showConsole={showConsole}
          unconfirmed={unconfirmedKeys.has(vmIdentityKey(vm))}
          onToggleSelect={toggleSelect}
          onPower={askRowPower}
          onDestroy={setPendingDestroy}
          onOpenBrowser={onOpenBrowser}
          onOpenBrowserNewWindow={onOpenBrowserNewWindow}
          onDownloadVv={onDownloadVv}
        />
        {pendingConfirm?.key === scope && (
          <tr>
            <td colSpan={columnCount} className="px-3 py-2 border-b border-border/50 bg-muted/20">
              <ConfirmBar
                pending={pendingConfirm}
                scope={scope}
                onConfirm={commitConfirm}
                onCancel={cancelConfirm}
              />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div>
      {pendingConfirm?.key === "power:selected" && (
        <div className="mb-2">
          <ConfirmBar
            pending={pendingConfirm}
            scope="power:selected"
            onConfirm={commitConfirm}
            onCancel={cancelConfirm}
          />
        </div>
      )}
      {selectedVMs.size > 0 && (
        <div className="flex items-center gap-2 p-3 mb-2 bg-muted/50 rounded-lg border border-border">
          <span className="text-sm text-muted-foreground">{selectedVMs.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" className="gap-1 text-status-success border-status-success/30"
              disabled={!!pendingConfirm || selectedArray.some((n) => loadingVMs.has(n))}
              onClick={() => askPower(selectedArray, "on", "selected")}>
              {selectedArray.some((n) => loadingVMs.has(n) && pendingPowerAction.get(n) === "on")
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Power className="h-3 w-3" />}
              Power On
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-status-info border-status-info/30"
              disabled={!!pendingConfirm || selectedArray.some((n) => loadingVMs.has(n)) || selectedArray.every((n) => {
                const vm = vms.find((v) => vmName(v) === n)
                return !vm || !isRunning(vm)
              })}
              onClick={() => askPower(selectedArray.filter((n) => {
                const vm = vms.find((v) => vmName(v) === n)
                return !!vm && isRunning(vm)
              }), "restart", "selected")}>
              {selectedArray.some((n) => loadingVMs.has(n) && pendingPowerAction.get(n) === "restart")
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RotateCw className="h-3 w-3" />}
              Restart
            </Button>
            <Button size="sm" variant="destructive"
              disabled={!!pendingConfirm || selectedArray.some((n) => loadingVMs.has(n))}
              onClick={() => askPower(selectedArray, "off", "selected")}>
              {selectedArray.some((n) => loadingVMs.has(n) && pendingPowerAction.get(n) === "off")
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <PowerOff className="h-3 w-3" />}
              Power Off
            </Button>
          </div>
        </div>
      )}

      {unconfirmedKeys.size > 0 && tableState === "ready" && (
        <div className="flex items-center gap-2 p-2 mb-2 rounded-md border border-status-warning/40 bg-status-warning/10 text-xs text-status-warning">
          <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
          Refreshing — {unconfirmedKeys.size} row{unconfirmedKeys.size === 1 ? "" : "s"} not confirmed by the latest poll.
        </div>
      )}

      <div className="rounded-lg border border-border overflow-x-auto">
        <div
          ref={virtualize ? scrollRef : undefined}
          className={virtualize ? "max-h-[70vh] overflow-y-auto overscroll-y-contain" : undefined}
        >
          <table className="w-full text-sm" aria-label="Range virtual machines">
            <thead>
              <VMTableHeader
                showConsole={showConsole}
                allSelected={selectedVMs.size === vms.length && vms.length > 0}
                someSelected={selectedVMs.size > 0}
                onToggleSelectAll={toggleSelectAll}
                sort={sort}
                onSort={onSort}
              />
            </thead>
            <tbody>
              {tableState === "loading" ? (
                <SkeletonRows showConsole={showConsole} />
              ) : tableState === "error" ? (
                <tr>
                  <td colSpan={columnCount} className="p-8 text-center text-muted-foreground">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-status-warning" />
                    <p className="font-medium text-foreground">Could not load VM inventory</p>
                    {errorMessage && <p className="text-xs mt-1 max-w-md mx-auto">{errorMessage}</p>}
                    {onRetry && (
                      <Button size="sm" variant="outline" className="gap-1.5 mt-3" onClick={onRetry}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ) : vms.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="p-8 text-center text-muted-foreground">
                    <Monitor className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>No VMs deployed yet</p>
                    <p className="text-xs mt-1">Deploy a range to get started</p>
                  </td>
                </tr>
              ) : (
                <>
                  {virtualize && paddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={columnCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {(virtualize ? visibleVms : sortedVms).map((vm) => renderRow(vm))}
                  {virtualize && paddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={columnCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={pendingDestroy !== null} onOpenChange={(open) => { if (!open) setPendingDestroy(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Destroy VM</DialogTitle>
            <DialogDescription>
              Permanently destroy VM &ldquo;{pendingDestroy ? vmName(pendingDestroy) : ""}&rdquo;
              {pendingDestroy ? ` (VMID ${pendingDestroy.proxmoxID ?? pendingDestroy.ID})` : ""}?
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDestroy(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDestroy()}>
              Destroy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
