"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Monitor, Power, PowerOff, RefreshCw, Circle, Download, MonitorPlay, Loader2, ExternalLink, Trash2 } from "lucide-react"
import type { VMObject } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ludusApi, postVmOperationAudit, pruneKnownHosts } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

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
}

export function VMTable({
  vms,
  onRefresh,
  rangeId,
  onOpenBrowser,
  onOpenBrowserNewWindow,
  onDownloadVv,
  downloadingVm,
  openingVm,
}: VMTableProps) {
  const { toast } = useToast()
  const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set())
  const [loadingVMs, setLoadingVMs] = useState<Set<string>>(new Set())
  const [destroyingProxmoxId, setDestroyingProxmoxId] = useState<number | null>(null)

  const vmName = (vm: VMObject) => vm.name || vm.vmName || `vm-${vm.ID}`
  const isRunning = (vm: VMObject) => vm.poweredOn ?? (vm.powerState === "running")
  const showConsole = !!(onOpenBrowser || onOpenBrowserNewWindow || onDownloadVv)

  const toggleSelect = (name: string) => {
    setSelectedVMs((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedVMs.size === vms.length) {
      setSelectedVMs(new Set())
    } else {
      setSelectedVMs(new Set(vms.map(vmName)))
    }
  }

  const handlePower = async (names: string[], action: "on" | "off") => {
    setLoadingVMs((prev) => new Set([...Array.from(prev), ...names]))
    // Scope to the current range so Ludus does not fall back to the user's
    // default range — which breaks (or targets the wrong range) whenever the
    // dashboard is showing a non-default or GOAD-mapped range. Without this,
    // Ludus returns `Range <id> not found for user <user>`.
    const result = action === "on"
      ? await ludusApi.powerOn(names, rangeId)
      : await ludusApi.powerOff(names, rangeId)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: `Power ${action}`, description: `${names.length} VM(s)` })
      onRefresh?.()
    }
    setLoadingVMs((prev) => {
      const next = new Set(prev)
      names.forEach((n) => next.delete(n))
      return next
    })
  }

  const handleDestroyVm = async (vm: VMObject) => {
    const name = vmName(vm)
    const proxmoxId = vm.proxmoxID ?? vm.ID
    if (
      !window.confirm(
        `Permanently destroy VM "${name}" (VMID ${proxmoxId})? This cannot be undone.`,
      )
    ) {
      return
    }
    setDestroyingProxmoxId(proxmoxId)
    const result = await ludusApi.destroyVm(proxmoxId, rangeId)
    if (result.error) {
      toast({ variant: "destructive", title: "Destroy failed", description: result.error })
      void postVmOperationAudit({
        kind: "destroy_vm",
        rangeId,
        vmId: proxmoxId,
        vmName: name,
        status: "error",
        detail: result.error,
      })
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
  }

  const selectedArray = Array.from(selectedVMs)
  const colSpan = 5 + (showConsole ? 1 : 0) + 1 + 1  // checkbox + name + status + ip + proxid + [console] + power + destroy

  const sortedVms = [...vms].sort((a, b) =>
    vmName(a).localeCompare(vmName(b), undefined, { sensitivity: "base" })
  )

  return (
    <div>
      {selectedVMs.size > 0 && (
        <div className="flex items-center gap-2 p-3 mb-2 bg-muted/50 rounded-lg border border-border">
          <span className="text-sm text-muted-foreground">{selectedVMs.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" className="gap-1 text-green-400 border-green-400/30"
              onClick={() => handlePower(selectedArray, "on")}>
              <Power className="h-3 w-3" /> Power On
            </Button>
            <Button size="sm" variant="destructive"
              onClick={() => handlePower(selectedArray, "off")}>
              <PowerOff className="h-3 w-3" /> Power Off
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="w-10 p-3">
                <Checkbox
                  checked={selectedVMs.size === vms.length && vms.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </th>
              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">VM Name</th>
              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">IP</th>
              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">VMID</th>
              {showConsole && (
                <th className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Console</th>
              )}
              <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Power</th>
              <th className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider w-14">
                Destroy
              </th>
            </tr>
          </thead>
          <tbody>
            {vms.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-8 text-center text-muted-foreground">
                  <Monitor className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No VMs deployed yet</p>
                  <p className="text-xs mt-1">Deploy a range to get started</p>
                </td>
              </tr>
            ) : (
              sortedVms.map((vm) => {
                const name = vmName(vm)
                const running = isRunning(vm)
                const powerLoading = loadingVMs.has(name)
                const isDownloading = downloadingVm === name
                const isOpening = openingVm === name
                const proxmoxId = vm.proxmoxID ?? vm.ID
                const isDestroying = destroyingProxmoxId === proxmoxId
                return (
                  <tr
                    key={vm.ID || name}
                    className={cn(
                      "border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors",
                      selectedVMs.has(name) && "bg-primary/5"
                    )}
                  >
                    <td className="p-3">
                      <Checkbox checked={selectedVMs.has(name)} onCheckedChange={() => toggleSelect(name)} />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="font-mono text-xs font-medium">{name}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <Circle className={cn("h-2 w-2 fill-current", running ? "text-green-400" : "text-red-400")} />
                        <span className={cn("text-xs", running ? "text-green-400" : "text-red-400")}>
                          {running ? "Running" : "Stopped"}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {vm.ip && vm.ip !== "null" ? vm.ip : "—"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-xs text-muted-foreground">{vm.proxmoxID || vm.ID}</span>
                    </td>
                    {showConsole && (
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          {onOpenBrowser && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon-sm" variant={running ? "ghost" : "ghost"}
                                  disabled={!running || isOpening}
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
                                  className={cn(!running && "opacity-30")}
                                  onClick={() => onDownloadVv(vm)}
                                >
                                  {isDownloading
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <Download className="h-3 w-3 text-cyan-400" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{running ? "Download .vv (virt-viewer / SPICE)" : "Power on first"}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon-sm" variant="ghost"
                              disabled={powerLoading || running}
                              onClick={() => handlePower([name], "on")}>
                              {powerLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3 text-green-400" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Power On</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon-sm" variant="ghost"
                              disabled={powerLoading || !running}
                              onClick={() => handlePower([name], "off")}>
                              <PowerOff className="h-3 w-3 text-red-400" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Power Off</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={powerLoading || isDestroying}
                            onClick={() => void handleDestroyVm(vm)}
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
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
