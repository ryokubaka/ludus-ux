"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { useRange } from "@/lib/range-context"
import { saveImpersonation } from "@/lib/impersonation-context"
import {
  navigateToRangeDashboard,
  persistSelectedRange,
  type ImpersonationFields,
} from "@/lib/navigate-to-range-dashboard"
import { ludusApi, postVmOperationAudit, pruneKnownHosts } from "@/lib/api"
import type { UserObject } from "@/lib/types"
import {
  groupInventoryRowsByRange,
  vmMatchesTemplateFilter,
  type RangeVmInventoryRow,
} from "@/lib/range-vm-inventory"
import { waitForVmPowerConfirmation } from "@/lib/wait-for-vm-power-state"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader2,
  RefreshCw,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Monitor,
  Power,
  PowerOff,
  MonitorPlay,
  Download,
  Circle,
  KeyRound,
  Terminal,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

const ALL = "__all__"

function rowKey(row: RangeVmInventoryRow): string {
  return `${row.rangeID}:${row.proxmoxID}`
}

export function VmInventoryTab() {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const { selectRange } = useRange()

  const templateFromUrl = searchParams.get("template")?.trim() || ""

  const [search, setSearch] = useState("")
  const [templateFilter, setTemplateFilter] = useState(templateFromUrl)
  const [rangeFilter, setRangeFilter] = useState(ALL)
  const [ownerFilter, setOwnerFilter] = useState(ALL)
  const [powerFilter, setPowerFilter] = useState(ALL)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [destroying, setDestroying] = useState<Set<string>>(new Set())
  const [powerLoading, setPowerLoading] = useState<Set<string>>(new Set())
  const [pendingPowerAction, setPendingPowerAction] = useState<Map<string, "on" | "off">>(new Map())
  const [downloadingVm, setDownloadingVm] = useState<string | null>(null)
  const [openingRangeId, setOpeningRangeId] = useState<string | null>(null)
  const [impersonateTarget, setImpersonateTarget] = useState<{
    rangeId: string
    displayName: string
    fields: ImpersonationFields
  } | null>(null)
  const [impersonateApiKey, setImpersonateApiKey] = useState("")
  const apiKeyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (templateFromUrl) setTemplateFilter(templateFromUrl)
  }, [templateFromUrl])

  const {
    data,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: queryKeys.adminRangeVms(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/admin/range-vms")
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      return res.json() as Promise<{ vms: RangeVmInventoryRow[]; ts: number }>
    },
    staleTime: STALE.short,
  })

  const { data: adminUsersData } = useQuery({
    queryKey: queryKeys.adminRangesData(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/admin/ranges-data")
      if (!res.ok) return { users: [] as UserObject[] }
      const json = await res.json() as { users?: UserObject[] }
      return { users: json.users ?? [] }
    },
    staleTime: STALE.medium,
  })

  const adminUsers = useMemo(
    () => (adminUsersData?.users ?? []).filter((u) => u.userID.toUpperCase() !== "ROOT"),
    [adminUsersData?.users],
  )

  const vms = useMemo(() => data?.vms ?? [], [data?.vms])

  const templateOptions = useMemo(() => {
    const set = new Set<string>()
    for (const vm of vms) {
      if (vm.template && vm.template !== "—") set.add(vm.template)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [vms])

  const rangeOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const vm of vms) map.set(vm.rangeID, vm.rangeName || vm.rangeID)
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [vms])

  const ownerOptions = useMemo(() => {
    const set = new Set<string>()
    for (const vm of vms) {
      if (vm.ownerUserID) set.add(vm.ownerUserID)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [vms])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vms.filter((vm) => {
      if (templateFilter && !vmMatchesTemplateFilter(vm.template, templateFilter)) return false
      if (rangeFilter !== ALL && vm.rangeID !== rangeFilter) return false
      if (ownerFilter !== ALL && vm.ownerUserID !== ownerFilter) return false
      if (powerFilter === "running" && !vm.poweredOn) return false
      if (powerFilter === "stopped" && vm.poweredOn) return false
      if (!q) return true
      return (
        vm.vmName.toLowerCase().includes(q) ||
        vm.rangeID.toLowerCase().includes(q) ||
        vm.ip.toLowerCase().includes(q) ||
        vm.template.toLowerCase().includes(q)
      )
    })
  }, [vms, search, templateFilter, rangeFilter, ownerFilter, powerFilter])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminRangeVms(scopeTag) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminRangesData(scopeTag) })
  }, [queryClient, scopeTag])

  const clearPendingPower = useCallback((keys: string[]) => {
    setPowerLoading((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => next.delete(k))
      return next
    })
    setPendingPowerAction((prev) => {
      const next = new Map(prev)
      keys.forEach((k) => next.delete(k))
      return next
    })
  }, [])

  useEffect(() => {
    if (pendingPowerAction.size === 0) return
    const confirmed: string[] = []
    for (const [key, action] of pendingPowerAction) {
      const row = vms.find((v) => rowKey(v) === key)
      if (!row) continue
      const matches = action === "on" ? row.poweredOn : !row.poweredOn
      if (matches) confirmed.push(key)
    }
    if (confirmed.length > 0) clearPendingPower(confirmed)
  }, [vms, pendingPowerAction, clearPendingPower])

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAll = () => {
    const keys = filtered.map(rowKey)
    const allSelected = keys.length > 0 && keys.every((k) => selected.has(k))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) keys.forEach((k) => next.delete(k))
      else keys.forEach((k) => next.add(k))
      return next
    })
  }

  const powerRows = async (rows: RangeVmInventoryRow[], action: "on" | "off") => {
    if (rows.length === 0) return
    const keys = rows.map(rowKey)
    setPowerLoading((prev) => new Set([...prev, ...keys]))
    setPendingPowerAction((prev) => {
      const next = new Map(prev)
      keys.forEach((k) => next.set(k, action))
      return next
    })

    let anySlow = false
    try {
      for (const [rangeId, group] of groupInventoryRowsByRange(rows)) {
        const names = group.map((r) => r.vmName)
        const result =
          action === "on"
            ? await ludusApi.powerOn(names, rangeId)
            : await ludusApi.powerOff(names, rangeId)

        if (result.error) {
          if (
            tryToastLudusSlowHttpError({
              toast,
              error: result.error,
              slowTitle: "Slow response from Ludus",
              onSlow: refresh,
            })
          ) {
            anySlow = true
          } else {
            toast({
              variant: "destructive",
              title: `Power ${action} failed`,
              description: `${rangeId}: ${result.error}`,
            })
          }
          continue
        }

        refresh()
        const wait = await waitForVmPowerConfirmation({
          rangeId,
          vmNames: names,
          action,
          fetchStatus: () => ludusApi.getRangeStatus(rangeId),
        })
        refresh()

        if (wait.ok) {
          toast({
            title: action === "on" ? "Power on confirmed" : "Power off confirmed",
            description: `${names.length} VM(s) in ${rangeId}`,
          })
        } else if (wait.via === "timeout") {
          toast({
            variant: "destructive",
            title: "Power state not confirmed yet",
            description: `${rangeId}: ${wait.pending.length} VM(s) may still be ${action === "on" ? "starting" : "stopping"}.`,
          })
        }
      }

      if (anySlow) {
        toast({
          title: action === "on" ? "Powering on" : "Powering off",
          description: "Ludus is still processing — refresh to check status.",
        })
      }
    } finally {
      clearPendingPower(keys)
    }
  }

  const destroyRows = async (rows: RangeVmInventoryRow[]) => {
    if (rows.length === 0) return
    const keys = rows.map(rowKey)
    setDestroying((prev) => new Set([...prev, ...keys]))

    let ok = 0
    let failed = 0
    for (const row of rows) {
      const result = await ludusApi.destroyVm(row.proxmoxID, row.rangeID)
      if (result.error) {
        failed++
        if (
          !tryToastLudusSlowHttpError({
            toast,
            error: result.error,
            slowTitle: "Slow response from Ludus",
            onSlow: refresh,
          })
        ) {
          toast({
            variant: "destructive",
            title: `Destroy failed: ${row.vmName}`,
            description: result.error,
          })
        }
        void postVmOperationAudit({
          kind: "destroy_vm",
          rangeId: row.rangeID,
          vmId: row.proxmoxID,
          vmName: row.vmName,
          status: "error",
          detail: result.error,
        })
      } else {
        ok++
        void postVmOperationAudit({
          kind: "destroy_vm",
          rangeId: row.rangeID,
          vmId: row.proxmoxID,
          vmName: row.vmName,
          status: "ok",
          detail: result.data?.result,
        })
        if (row.ip.trim()) void pruneKnownHosts([row.ip.trim()])
      }
    }

    setDestroying((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => next.delete(k))
      return next
    })
    setSelected((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => next.delete(k))
      return next
    })

    if (ok > 0) {
      toast({
        title: `${ok} VM${ok > 1 ? "s" : ""} destroyed`,
        description: failed > 0 ? `${failed} failed` : undefined,
      })
      refresh()
    }
  }

  const handleDestroyOne = (row: RangeVmInventoryRow) => {
    if (
      !window.confirm(
        `Permanently destroy VM "${row.vmName}" (VMID ${row.proxmoxID}) in range ${row.rangeID}?`,
      )
    ) {
      return
    }
    void destroyRows([row])
  }

  const handleDestroySelected = () => {
    const rows = filtered.filter((r) => selected.has(rowKey(r)))
    if (rows.length === 0) return
    if (
      !window.confirm(
        `Permanently destroy ${rows.length} selected VM${rows.length > 1 ? "s" : ""}? This cannot be undone.`,
      )
    ) {
      return
    }
    void destroyRows(rows)
  }

  const handlePowerSelected = (action: "on" | "off") => {
    const rows = filtered.filter((r) => selected.has(rowKey(r)))
    if (rows.length === 0) return
    void powerRows(rows, action)
  }

  const handleDownloadVv = async (row: RangeVmInventoryRow) => {
    const id = row.proxmoxID
    const name = row.vmName
    if (!id) {
      toast({ variant: "destructive", title: "No VM ID" })
      return
    }
    setDownloadingVm(name)
    try {
      const res = await fetch(
        `/api/console/spice?vmId=${id}&vmName=${encodeURIComponent(name)}`,
      )
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.vv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ title: "Downloaded", description: `Open ${name}.vv with virt-viewer` })
    } catch (err) {
      toast({ variant: "destructive", title: "Console failed", description: (err as Error).message })
    } finally {
      setDownloadingVm(null)
    }
  }

  const handleOpenBrowser = (row: RangeVmInventoryRow) => {
    const id = row.proxmoxID
    if (!id) {
      toast({ variant: "destructive", title: "No VM ID" })
      return
    }
    router.push(`/console?vmId=${id}&vmName=${encodeURIComponent(row.vmName)}`)
  }

  const handleOpenBrowserNewWindow = (row: RangeVmInventoryRow) => {
    const id = row.proxmoxID
    if (!id) {
      toast({ variant: "destructive", title: "No VM ID" })
      return
    }
    window.open(
      `/console?vmId=${id}&vmName=${encodeURIComponent(row.vmName)}`,
      "_blank",
      "noopener,noreferrer",
    )
  }

  const openRangeDashboard = useCallback(
    async (row: RangeVmInventoryRow) => {
      if (openingRangeId) return
      setOpeningRangeId(row.rangeID)
      try {
        const result = await navigateToRangeDashboard({
          rangeId: row.rangeID,
          ownerUserID: row.ownerUserID,
          users: adminUsers,
          selectRange,
        })

        if (result.ok) {
          router.push("/")
          return
        }

        if (result.reason === "impersonation_manual") {
          setImpersonateTarget({
            rangeId: row.rangeID,
            displayName: result.displayName,
            fields: result.fields,
          })
          setImpersonateApiKey("")
          setTimeout(() => apiKeyInputRef.current?.focus(), 50)
          if (result.message) {
            toast({
              variant: "destructive",
              title: "Could not auto-read API key",
              description: result.message,
            })
          }
          return
        }

        toast({
          variant: "destructive",
          title: "Could not open range",
          description: result.message,
        })
      } finally {
        setOpeningRangeId(null)
      }
    },
    [adminUsers, openingRangeId, router, selectRange, toast],
  )

  const commitRangeImpersonation = useCallback(async () => {
    if (!impersonateTarget || !impersonateApiKey.trim()) {
      toast({ variant: "destructive", title: "API key required" })
      return
    }
    const target = impersonateTarget
    try {
      await saveImpersonation({ ...target.fields, apiKey: impersonateApiKey.trim() })
      persistSelectedRange(target.rangeId)
      selectRange(target.rangeId)
      setImpersonateTarget(null)
      toast({ title: `Now managing as ${target.displayName}` })
      router.push("/")
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Impersonation failed",
        description: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }, [impersonateApiKey, impersonateTarget, router, selectRange, toast])

  const selectedRows = filtered.filter((r) => selected.has(rowKey(r)))
  const selectedCount = selectedRows.length
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(rowKey(r)))
  const anyPowerLoading = selectedRows.some((r) => powerLoading.has(rowKey(r)))

  return (
    <div className="space-y-4">
      {impersonateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl border-primary/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" />
                  Open range as{" "}
                  <code className="text-primary font-mono">{impersonateTarget.displayName}</code>
                </CardTitle>
                <Button size="icon-sm" variant="ghost" onClick={() => setImpersonateTarget(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <KeyRound className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Range <code className="font-mono">{impersonateTarget.rangeId}</code> belongs to{" "}
                  {impersonateTarget.displayName}. Enter their Ludus API key to open the dashboard.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label htmlFor="vm-range-impersonate-apikey" className="text-xs">
                  Ludus API Key
                </Label>
                <Input
                  id="vm-range-impersonate-apikey"
                  ref={apiKeyInputRef}
                  type="password"
                  autoComplete="off"
                  value={impersonateApiKey}
                  onChange={(e) => setImpersonateApiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRangeImpersonation()
                  }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setImpersonateTarget(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void commitRangeImpersonation()} disabled={!impersonateApiKey.trim()}>
                  Open dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {templateFromUrl && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Showing VMs deployed from template{" "}
            <code className="text-primary font-mono">{templateFromUrl}</code>. Remove or destroy
            them to unlock template deletion.{" "}
            <Link href="/templates" className="underline text-primary">
              Back to Templates
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              Range VMs
              {!isLoading && (
                <Badge variant="secondary" className="font-normal">
                  {filtered.length} / {vms.length}
                </Badge>
              )}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={refresh} disabled={isFetching} title="Refresh">
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <Input
              placeholder="Search name, IP, range…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="lg:col-span-2"
            />
            <Select
              value={templateFilter || ALL}
              onValueChange={(v) => setTemplateFilter(v === ALL ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All templates" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All templates</SelectItem>
                {templateOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rangeFilter} onValueChange={setRangeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All ranges" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All ranges</SelectItem>
                {rangeOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name} ({id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All owners" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All owners</SelectItem>
                {ownerOptions.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={powerFilter} onValueChange={setPowerFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Power state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All power states</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border flex-wrap">
              <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
              <div className="flex gap-2 ml-auto flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-status-success border-status-success/30"
                  disabled={anyPowerLoading}
                  onClick={() => handlePowerSelected("on")}
                >
                  {anyPowerLoading && selectedRows.some((r) => pendingPowerAction.get(rowKey(r)) === "on") ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Power className="h-3 w-3" />
                  )}
                  Power On
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={anyPowerLoading}
                  onClick={() => handlePowerSelected("off")}
                >
                  {anyPowerLoading && selectedRows.some((r) => pendingPowerAction.get(rowKey(r)) === "off") ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <PowerOff className="h-3 w-3" />
                  )}
                  Power Off
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1"
                  onClick={handleDestroySelected}
                >
                  <Trash2 className="h-3 w-3" />
                  Destroy ({selectedCount})
                </Button>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{(error as Error).message}</AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading VMs…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {vms.length === 0 ? "No range VMs deployed." : "No VMs match the current filters."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-3 w-10">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all visible VMs"
                      />
                    </th>
                    <th className="p-3 font-medium">VM</th>
                    <th className="p-3 font-medium">Range</th>
                    <th className="p-3 font-medium">Owner</th>
                    <th className="p-3 font-medium">Template</th>
                    <th className="p-3 font-medium">IP</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">VMID</th>
                    <th className="p-3 font-medium text-center">Console</th>
                    <th className="p-3 font-medium text-right">Power</th>
                    <th className="p-3 font-medium text-center w-14">Destroy</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const key = rowKey(row)
                    const busyDestroy = destroying.has(key)
                    const busyPower = powerLoading.has(key)
                    const pendingAction = pendingPowerAction.get(key)
                    const isSelected = selected.has(key)
                    const running = row.poweredOn
                    const isDownloading = downloadingVm === row.vmName

                    return (
                      <tr
                        key={key}
                        className={cn(
                          "border-b border-border/50 last:border-0 hover:bg-muted/30",
                          isSelected && "bg-primary/5",
                        )}
                      >
                        <td className="p-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(key)}
                          />
                        </td>
                        <td className="p-3 font-mono text-xs">{row.vmName}</td>
                        <td className="p-3">
                          <button
                            type="button"
                            className="text-primary hover:underline text-xs font-mono disabled:opacity-50"
                            disabled={openingRangeId === row.rangeID}
                            onClick={() => void openRangeDashboard(row)}
                          >
                            {openingRangeId === row.rangeID ? (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {row.rangeID}
                              </span>
                            ) : (
                              row.rangeID
                            )}
                          </button>
                        </td>
                        <td className="p-3 text-xs">{row.ownerUserID || "—"}</td>
                        <td className="p-3 font-mono text-xs max-w-[180px] truncate" title={row.template}>
                          {row.template}
                        </td>
                        <td className="p-3 font-mono text-xs">{row.ip || "—"}</td>
                        <td className="p-3">
                          {busyPower ? (
                            <div className="flex items-center gap-1.5">
                              <Loader2 className="h-3 w-3 animate-spin text-status-warning" />
                              <span className="text-xs text-status-warning">
                                {pendingAction === "on" ? "Starting…" : "Stopping…"}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Circle
                                className={cn(
                                  "h-2 w-2 fill-current",
                                  running ? "text-status-success" : "text-status-error",
                                )}
                              />
                              <span
                                className={cn(
                                  "text-xs",
                                  running ? "text-status-success" : "text-status-error",
                                )}
                              >
                                {running ? "Running" : "Stopped"}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="p-3 font-mono text-xs">{row.proxmoxID}</td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={!running}
                                  className={cn(!running && "opacity-30")}
                                  onClick={() => handleOpenBrowser(row)}
                                >
                                  <MonitorPlay className="h-3 w-3 text-primary" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {running ? "Browser console (noVNC)" : "Power on first"}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={!running}
                                  className={cn(!running && "opacity-30")}
                                  onClick={() => handleOpenBrowserNewWindow(row)}
                                >
                                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {running ? "Open console in new window" : "Power on first"}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={!running || isDownloading}
                                  className={cn(!running && "opacity-30")}
                                  onClick={() => void handleDownloadVv(row)}
                                >
                                  {isDownloading ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Download className="h-3 w-3 text-primary" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {running ? "Download .vv (virt-viewer / SPICE)" : "Power on first"}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={busyPower || running}
                                  onClick={() => void powerRows([row], "on")}
                                >
                                  {busyPower && pendingAction === "on" ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-status-success" />
                                  ) : (
                                    <Power className="h-3 w-3 text-status-success" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Power On</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={busyPower || !running}
                                  onClick={() => void powerRows([row], "off")}
                                >
                                  {busyPower && pendingAction === "off" ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-status-error" />
                                  ) : (
                                    <PowerOff className="h-3 w-3 text-status-error" />
                                  )}
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
                                disabled={busyDestroy || busyPower}
                                onClick={() => handleDestroyOne(row)}
                              >
                                {busyDestroy ? (
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
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
