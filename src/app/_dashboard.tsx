"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { VMTable } from "@/components/range/vm-table"
import { LogViewer } from "@/components/range/log-viewer"
import {
  Server,
  Layers,
  Activity,
  RefreshCw,
  Play,
  StopCircle,
  Power,
  PowerOff,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wifi,
  ChevronDown,
  ChevronRight,
  Network,
  List,
  FileCode2,
  Download,
  X,
  Trash2,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import { useRange } from "@/lib/range-context"
import type { RangeObject, VMObject } from "@/lib/types"
import { cn, getRangeStateBadge } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useDeployLogContext } from "@/lib/deploy-log-context"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"

function dedupeVMs(vms: VMObject[]): VMObject[] {
  const seen = new Set<number | string>()
  return vms.filter((vm) => {
    const key = vm.proxmoxID ?? vm.ID
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function DashboardPageClient() {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const { selectedRangeId, ranges: accessibleRanges, loading: rangeCtxLoading, selectRange, refreshRanges } = useRange()

  const hasNoRanges = !rangeCtxLoading && accessibleRanges.length === 0 && !selectedRangeId

  // ── UI state ────────────────────────────────────────────────────────────────
  const [expandedRanges, setExpandedRanges] = useState<Set<string>>(new Set())
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [etcHosts, setEtcHosts] = useState<string | null>(null)
  const [showHosts, setShowHosts] = useState(false)
  const [inventoryText, setInventoryText] = useState<string | null>(null)
  const [showInventory, setShowInventory] = useState(false)
  const [deletingRangeId, setDeletingRangeId] = useState<string | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [downloadingVm, setDownloadingVm] = useState<string | null>(null)
  const [openingVm, setOpeningVm] = useState<string | null>(null)

  // ── Deploy log stream ───────────────────────────────────────────────────────
  const { lines: logLines, isStreaming, rangeState: streamRangeState, activeRangeId: streamingRangeId, startStreaming, stopStreaming, clearLogs } = useDeployLogContext()

  // ── Range status query ──────────────────────────────────────────────────────
  // Replaces fetchRanges + silentRefresh + setInterval(silentRefresh, 15000).
  // - isLoading is true ONLY on the very first fetch (no cached data available)
  // - isFetching is true during any background revalidation
  // - refetchInterval keeps the dashboard live without manual polling code
  const {
    data: rangeData,
    isLoading,
    isFetching,
    isPlaceholderData,
    error: rangeError,
  } = useQuery({
    queryKey: queryKeys.rangeStatus(selectedRangeId),
    queryFn: async () => {
      const result = await ludusApi.getRangeStatus(selectedRangeId ?? undefined)
      if (result.error) {
        // A 400 with no selectedRangeId just means no default range — not an error worth showing
        if (result.status === 400 && !selectedRangeId) return null
        throw new Error(typeof result.error === "string" ? result.error : "Failed to load range status")
      }
      if (!result.data) return null
      const data = result.data
      return { ...data, VMs: dedupeVMs(data.VMs || (data as RangeObject & { vms?: VMObject[] }).vms || []) }
    },
    enabled: !rangeCtxLoading && !hasNoRanges,
    staleTime: STALE.realtime,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    // When selectedRangeId transitions from null → saved ID, keep showing
    // the previous key's data as a placeholder while the new key fetches.
    // Prevents the "data disappears → loading → data reappears" flash.
    placeholderData: keepPreviousData,
  })

  // ── Version query ───────────────────────────────────────────────────────────
  const { data: versionData } = useQuery({
    queryKey: queryKeys.version(),
    queryFn: async () => {
      const result = await ludusApi.getVersion()
      return result.data ?? null
    },
    staleTime: STALE.long,
  })
  const version = versionData ? (versionData.result || versionData.version || "") : ""

  // ── Auto-expand range when data arrives ────────────────────────────────────
  useEffect(() => {
    if (!rangeData) return
    const rangeKey = rangeData.rangeID || rangeData.name || "range-0"
    setExpandedRanges((e) => new Set([...e, rangeKey]))
    setLastRefreshed(new Date())
  }, [rangeData])

  // ── Reset stream state on range change ─────────────────────────────────────
  useEffect(() => {
    if (rangeCtxLoading) return
    const streamIsForThisRange = isStreaming && streamingRangeId === (selectedRangeId ?? null)
    if (!streamIsForThisRange) {
      stopStreaming()
      clearLogs()
    }
    setShowLogs(streamIsForThisRange)
    setDeploying(streamIsForThisRange)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRangeId, rangeCtxLoading])

  // ── Detect an in-progress deploy when range data first loads ───────────────
  // Fires when:
  //  • selectedRangeId changes (user switches range)
  //  • rangeCtxLoading toggles
  //  • Real data for the CURRENT range arrives for the first time
  //
  // The rangeDataId dep handles the case where we navigate to dashboard right
  // after deploying a new range: selectedRangeId is set immediately, but the
  // rangeStatus query is still in-flight. When the data arrives (changing
  // rangeDataId from undefined → the range ID), the effect re-fires and finds
  // rangeState === "DEPLOYING", starting the log stream automatically.
  //
  // isPlaceholderData guard prevents the previous range's stale data (shown
  // during key transition via keepPreviousData) from triggering a false positive.
  const streamIsForThisRange = isStreaming && streamingRangeId === (selectedRangeId ?? null)
  const rangeDataId = !isPlaceholderData ? (rangeData?.rangeID ?? rangeData?.name ?? null) : null
  useEffect(() => {
    if (!rangeData || isPlaceholderData || rangeCtxLoading || hasNoRanges) return
    if (rangeData.rangeState === "DEPLOYING") {
      setDeploying(true)
      setShowLogs(true)
      if (!streamIsForThisRange) startStreaming(selectedRangeId ?? undefined)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRangeId, rangeCtxLoading, rangeDataId])

  // ── Stream completion → refresh data and hide logs ─────────────────────────
  useEffect(() => {
    if (!isStreaming && streamRangeState && streamRangeState !== "DEPLOYING" && streamRangeState !== "WAITING") {
      setDeploying(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(selectedRangeId) })
      setTimeout(() => setShowLogs(false), 5000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, streamRangeState])

  const invalidateRangeStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(selectedRangeId) })
  }, [queryClient, selectedRangeId])

  // ── Deploy actions ──────────────────────────────────────────────────────────
  const doDeploy = async () => {
    clearLogs()
    setShowLogs(true)
    setDeploying(true)
    const result = await ludusApi.deployRange(undefined, undefined, selectedRangeId ?? undefined)
    if (result.error) {
      toast({ variant: "destructive", title: "Deploy failed", description: result.error })
      setDeploying(false)
      return
    }
    toast({ title: "Deploy started" })
    startStreaming(selectedRangeId ?? undefined)
  }
  const handleDeploy = () => confirm("Start range deployment?", doDeploy)

  const doAbort = async () => {
    if (!selectedRangeId) {
      toast({ variant: "destructive", title: "No range selected", description: "Select a range before aborting." })
      return
    }
    const result = await ludusApi.abortDeploy(selectedRangeId)
    if (result.error) {
      const noProcess = typeof result.error === "string" && /no ansible/i.test(result.error)
      if (noProcess) {
        toast({
          title: "Range state is stale",
          description:
            "Ludus reports no ansible process running, but the range is still marked DEPLOYING. " +
            "This is a Ludus server-side state inconsistency — no VMs were touched. " +
            "To reset, log in to the Pocketbase DB (Ludus server port 8081) and log in with the root@ludus.internal (password is the root API key), " +
            "or contact your Ludus admin to manually update the range record.",
          duration: 15000,
        })
        invalidateRangeStatus()
        return
      }
      toast({ variant: "destructive", title: "Abort failed", description: result.error })
    } else {
      toast({ title: "Deploy aborted" })
      setDeploying(false)
      invalidateRangeStatus()
    }
  }
  const handleAbort = () => confirm("Abort the running deployment?", doAbort)

  const doDeleteRange = async (rangeId: string, _vmCount: number) => {
    setDeletingRangeId(rangeId)
    try {
      const result = await ludusApi.deleteRange(rangeId)
      if (result.error) {
        toast({ variant: "destructive", title: "Delete failed", description: result.error })
        return
      }

      // ── GOAD workspace cleanup ──────────────────────────────────────────────
      try {
        const instRes = await fetch("/api/goad/instances")
        if (instRes.ok) {
          const instData = await instRes.json()
          const instances: { instanceId: string; ludusRangeId?: string }[] = instData.instances ?? []
          const associated = instances.filter((i) => i.ludusRangeId === rangeId)
          await Promise.all(
            associated.map((inst) =>
              fetch(`/api/goad/instances/${encodeURIComponent(inst.instanceId)}/force-delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ludusRangeId: rangeId, skipRangeDeletion: true }),
              }).catch(() => {})
            )
          )
        }
      } catch {
        // Non-fatal
      }

      toast({ title: "Range deleted", description: `${rangeId} has been permanently removed` })

      // Remove stale cache entry immediately so the UI shows nothing while the
      // context picks the next range.
      queryClient.removeQueries({ queryKey: queryKeys.rangeStatus(rangeId) })

      await refreshRanges()

      if (rangeId === selectedRangeId) {
        const remaining = accessibleRanges.filter((r) => r.rangeID !== rangeId)
        if (remaining.length > 0) selectRange(remaining[0].rangeID)
      }
    } finally {
      setDeletingRangeId(null)
    }
  }
  const handleDeleteRange = (rangeId: string, rangeName: string, vmCount: number) =>
    confirm(
      [
        `Permanently DELETE range "${rangeName}"?`,
        "",
        `This will:`,
        `  • Power off and destroy all ${vmCount} VM${vmCount !== 1 ? "s" : ""}`,
        `  • Remove the Proxmox pool "${rangeId}"`,
        `  • Remove the range record from the database`,
        "",
        `This CANNOT be undone.`,
      ].join("\n"),
      () => doDeleteRange(rangeId, vmCount)
    )

  const doPowerAll = async (action: "on" | "off") => {
    const vms = rangeData?.VMs || (rangeData as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []
    const vmNames = vms.map((v: VMObject) => v.name || `vm-${v.ID}`).filter(Boolean)
    if (vmNames.length === 0) {
      toast({ variant: "destructive", title: "No VMs", description: "No VMs in this range to power " + action })
      return
    }
    const result = action === "on"
      ? await ludusApi.powerOn(vmNames, selectedRangeId ?? undefined)
      : await ludusApi.powerOff(vmNames, selectedRangeId ?? undefined)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: `Powering ${action} all VMs`, description: `${vmNames.length} VMs targeted` })
      setTimeout(invalidateRangeStatus, 3000)
    }
  }
  const handlePowerAll = (action: "on" | "off") =>
    confirm(
      action === "on" ? `Power ON all VMs in this range?` : `Power OFF all VMs in this range?`,
      () => doPowerAll(action)
    )

  // ── Range extras ────────────────────────────────────────────────────────────
  const extractText = (data: unknown) => {
    const d = data as { result?: string }
    return d?.result || (typeof data === "string" ? data : "")
  }

  const handleGetHosts = async () => {
    const result = await ludusApi.getRangeEtcHosts()
    if (result.data) { setEtcHosts(extractText(result.data)); setShowHosts(true) }
    else toast({ variant: "destructive", title: "Error", description: String(result.error) })
  }

  const handleShowInventory = async () => {
    const result = await ludusApi.getRangeEtcHosts()
    if (result.data) { setInventoryText(extractText(result.data)); setShowInventory(true) }
    else toast({ variant: "destructive", title: "Error", description: String(result.error) })
  }

  const downloadText = (text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Console actions ─────────────────────────────────────────────────────────
  const vmName = (vm: VMObject) => vm.name || `vm-${vm.ID}`
  const vmId = (vm: VMObject) => vm.proxmoxID || vm.ID

  const handleDownloadVv = async (vm: VMObject) => {
    const name = vmName(vm)
    const id = vmId(vm)
    if (!id) { toast({ variant: "destructive", title: "No VM ID" }); return }
    setDownloadingVm(name)
    try {
      const res = await fetch(`/api/console/spice?vmId=${id}&vmName=${encodeURIComponent(name)}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.vv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ title: "Downloaded", description: `Open ${name}.vv with virt-viewer` })
    } catch (err) {
      toast({ variant: "destructive", title: "Console failed", description: (err as Error).message })
    } finally {
      setDownloadingVm(null)
    }
  }

  const handleOpenBrowser = (vm: VMObject) => {
    const name = vmName(vm)
    const id = vmId(vm)
    if (!id) { toast({ variant: "destructive", title: "No VM ID" }); return }
    router.push(`/console?vmId=${id}&vmName=${encodeURIComponent(name)}`)
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const primaryRange = rangeData ?? null
  const allVMs = primaryRange?.VMs || (primaryRange as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []
  const runningVMs = allVMs.filter((v) => v.poweredOn || v.powerState === "running").length
  const rangeState = primaryRange?.rangeState || "NEVER DEPLOYED"
  const error = rangeError ? (rangeError as Error).message : null

  const toggleRange = (id: string) => {
    setExpandedRanges((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Use ranges array for the accordion (single range from the query)
  const ranges = primaryRange ? [primaryRange] : []

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {error.includes("Connection failed")
              ? "Cannot connect to Ludus server. Check your LUDUS_URL and LUDUS_API_KEY settings."
              : error}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Range State" icon={<Activity className="h-4 w-4 text-primary" />}
          value={isLoading
            ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            : <Badge className={cn("text-xs", getRangeStateBadge(rangeState))}>{rangeState}</Badge>}
        />
        <StatCard title="Total VMs" icon={<Server className="h-4 w-4 text-blue-400" />}
          value={isLoading ? "—" : String(allVMs.length)} />
        <StatCard title="Running" icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
          value={isLoading ? "—" : String(runningVMs)}
          subtext={allVMs.length > 0 ? `${Math.round((runningVMs / allVMs.length) * 100)}% online` : undefined}
        />
        <StatCard title="Ludus Version" icon={<Layers className="h-4 w-4 text-cyan-400" />}
          value={isLoading ? "—" : (version ? (version.split(" ").pop() || "—") : "—")}
          subtext={version ? version.replace(/\s+\S+$/, "") : "Not connected"}
        />
      </div>

      {/* ── Range accordions ──────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : ranges.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <Server className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No ranges available yet.</p>
            <Link href="/range/new">
              <Button className="gap-1.5">
                <Play className="h-3.5 w-3.5" /> Deploy a New Range
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        ranges.map((range, idx) => {
          const rangeKey = range.rangeID || range.name || `range-${idx}`
          const isExpanded = expandedRanges.has(rangeKey)
          const vms = range.VMs || (range as RangeObject & { vms?: VMObject[] }).vms || []
          const running = vms.filter((v) => v.poweredOn || v.powerState === "running").length
          const state = range.rangeState || "NEVER DEPLOYED"

          return (
            <Card key={rangeKey} className="overflow-hidden">
              {/* ── Accordion header ──────────────────────────────────────── */}
              <button
                className="w-full text-left"
                onClick={() => toggleRange(rangeKey)}
              >
                <CardHeader className="pb-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <Server className="h-4 w-4 text-primary" />
                      <CardTitle className="text-sm font-semibold">
                        {range.name || range.rangeID || `Range ${range.rangeNumber ?? idx + 1}`}
                      </CardTitle>
                      {range.rangeNumber != null && (
                        <span className="text-xs text-muted-foreground font-mono">#{range.rangeNumber}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        <span className="text-green-400 font-medium">{running}</span>
                        <span> / {vms.length} running</span>
                      </span>
                      <Badge className={cn("text-xs", getRangeStateBadge(state))}>{state}</Badge>
                      {lastRefreshed && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Wifi className={cn("h-3 w-3", isFetching ? "text-yellow-400 animate-pulse" : "text-green-400")} />
                          {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {isExpanded && (
                <CardContent className="pt-0 space-y-4">
                  {/* ── Action bar ──────────────────────────────────────── */}
                  <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button onClick={handleDeploy} disabled={deploying || state === "DEPLOYING" || !!pendingAction} className="gap-1.5">
                      {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      {deploying ? "Deploying…" : "Deploy"}
                    </Button>
                    {(deploying || state === "DEPLOYING") && (
                      <Button variant="destructive" onClick={handleAbort} disabled={!!pendingAction} className="gap-1.5">
                        <StopCircle className="h-3.5 w-3.5" /> Abort
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => handlePowerAll("on")} disabled={!!pendingAction} className="gap-1.5">
                      <Power className="h-3.5 w-3.5 text-green-400" /> All On
                    </Button>
                    <Button variant="outline" onClick={() => handlePowerAll("off")} disabled={!!pendingAction} className="gap-1.5">
                      <PowerOff className="h-3.5 w-3.5 text-red-400" /> All Off
                    </Button>
                    <Button variant="outline" onClick={handleGetHosts} className="gap-1.5">
                      <Network className="h-3.5 w-3.5" /> /etc/hosts
                    </Button>
                    <Button variant="outline" onClick={handleShowInventory} className="gap-1.5">
                      <List className="h-3.5 w-3.5" /> Inventory
                    </Button>
                    <Link href="/range/config">
                      <Button variant="ghost" className="gap-1.5">
                        <FileCode2 className="h-3.5 w-3.5" /> Config & Deploy
                      </Button>
                    </Link>
                    <Button variant="ghost" size="icon" onClick={invalidateRangeStatus} disabled={isFetching} className="ml-auto">
                      <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                    </Button>
                    {range.testingEnabled && (
                      <Badge variant="warning" className="flex items-center gap-1 px-3 py-1.5">
                        <Shield className="h-3 w-3" /> Testing Mode
                      </Badge>
                    )}
                    {/* Destructive zone — separated to avoid accidental clicks */}
                    <div className="w-px h-6 bg-border/60 mx-1 self-center" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/30"
                      disabled={!!pendingAction || state === "DEPLOYING" || !!deletingRangeId}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteRange(range.rangeID || rangeKey, range.name || range.rangeID || rangeKey, vms.length)
                      }}
                    >
                      {deletingRangeId === (range.rangeID || rangeKey) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {deletingRangeId === (range.rangeID || rangeKey) ? "Deleting…" : "Delete Range"}
                    </Button>
                  </div>

                  {/* ── Deploy logs ─────────────────────────────────────── */}
                  {showLogs && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <Activity className={cn("h-3.5 w-3.5", isStreaming && "animate-pulse text-green-400")} />
                          Deploy Logs
                          {isStreaming && <Badge variant="success" className="text-xs">Live</Badge>}
                        </h4>
                        <Button size="sm" variant="ghost" onClick={() => setShowLogs(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <LogViewer lines={logLines} onClear={clearLogs} maxHeight="300px" />
                    </div>
                  )}
                  {!showLogs && (deploying || state === "DEPLOYING") && (
                    <Button size="sm" variant="ghost" onClick={() => setShowLogs(true)} className="gap-1.5 text-xs">
                      <Activity className="h-3.5 w-3.5 animate-pulse text-green-400" />
                      Show deploy logs
                    </Button>
                  )}

                  {/* ── /etc/hosts viewer ───────────────────────────────── */}
                  {showHosts && etcHosts && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
                        <span className="text-xs font-mono font-semibold">/etc/hosts</span>
                        <div className="flex gap-1">
                          <Button size="icon-sm" variant="ghost" onClick={() => downloadText(etcHosts, "hosts")}>
                            <Download className="h-3 w-3" />
                          </Button>
                          <Button size="icon-sm" variant="ghost" onClick={() => setShowHosts(false)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <pre className="p-3 text-xs font-mono overflow-auto max-h-48 bg-black/60">{etcHosts}</pre>
                    </div>
                  )}

                  {/* ── Ansible inventory viewer ────────────────────────── */}
                  {showInventory && inventoryText && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
                        <span className="text-xs font-mono font-semibold">Ansible Inventory</span>
                        <div className="flex gap-1">
                          <Button size="icon-sm" variant="ghost" onClick={() => downloadText(inventoryText, "inventory")}>
                            <Download className="h-3 w-3" />
                          </Button>
                          <Button size="icon-sm" variant="ghost" onClick={() => setShowInventory(false)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <pre className="p-3 text-xs font-mono overflow-auto max-h-48 bg-black/60">{inventoryText}</pre>
                    </div>
                  )}

                  {/* ── VM table with console actions ────────────────────── */}
                  <VMTable
                    vms={vms}
                    onRefresh={invalidateRangeStatus}
                    onDownloadVv={handleDownloadVv}
                    onOpenBrowser={handleOpenBrowser}
                    downloadingVm={downloadingVm}
                    openingVm={openingVm}
                  />
                </CardContent>
              )}
            </Card>
          )
        })
      )}
    </div>
  )
}

function StatCard({
  title, value, icon, subtext,
}: {
  title: string
  value: React.ReactNode
  icon: React.ReactNode
  subtext?: string
}) {
  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          {icon}
        </div>
        <div className="text-xl font-bold">{value}</div>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </CardContent>
    </Card>
  )
}
