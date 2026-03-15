"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
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

export default function DashboardPage() {
  const { toast } = useToast()
  const router = useRouter()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const { selectedRangeId, ranges: accessibleRanges, loading: rangeCtxLoading, selectRange, refreshRanges } = useRange()

  // ── Global ─────────────────────────────────────────────────────────────────
  const [ranges, setRanges] = useState<RangeObject[]>([])
  const [version, setVersion] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const initialLoadDoneRef = useRef(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasNoRanges = !rangeCtxLoading && accessibleRanges.length === 0 && !selectedRangeId

  // ── Per-range expanded state (first range auto-expanded) ───────────────────
  const [expandedRanges, setExpandedRanges] = useState<Set<string>>(new Set())
  const [etcHosts, setEtcHosts] = useState<string | null>(null)
  const [showHosts, setShowHosts] = useState(false)
  const [inventoryText, setInventoryText] = useState<string | null>(null)
  const [showInventory, setShowInventory] = useState(false)

  // ── Deploy ─────────────────────────────────────────────────────────────────
  const [deploying, setDeploying] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const { lines: logLines, isStreaming, rangeState: streamRangeState, activeRangeId: streamingRangeId, startStreaming, stopStreaming, clearLogs } = useDeployLogContext()

  // When the global stream completes (moved out of DEPLOYING/WAITING), sync local UI state
  useEffect(() => {
    if (!isStreaming && streamRangeState && streamRangeState !== "DEPLOYING" && streamRangeState !== "WAITING") {
      setDeploying(false)
      fetchRanges()
      setTimeout(() => setShowLogs(false), 5000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, streamRangeState])

  // ── Console ────────────────────────────────────────────────────────────────
  const [downloadingVm, setDownloadingVm] = useState<string | null>(null)
  const [openingVm, setOpeningVm] = useState<string | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────
  // De-duplicate VMs by proxmoxID/ID to guard against occasional API-level duplicates
  // that appear during active deployments (VMs being provisioned or powered on).
  const dedupeVMs = (vms: VMObject[]): VMObject[] => {
    const seen = new Set<number | string>()
    return vms.filter((vm) => {
      const key = vm.proxmoxID ?? vm.ID
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const applyRangeData = useCallback((r: RangeObject) => {
    const deduped = { ...r, VMs: dedupeVMs(r.VMs || (r as RangeObject & { vms?: VMObject[] }).vms || []) }
    const rangeKey = r.rangeID || r.name || "range-0"
    setRanges([deduped])
    // Always ensure the current range is expanded (handles impersonation switches)
    setExpandedRanges((e) => new Set([...e, rangeKey]))
    setLastRefreshed(new Date())
  }, [])

  const fetchRanges = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setError(null)
    const isInitial = !initialLoadDoneRef.current
    if (isInitial) setLoading(true)
    else setRefreshing(true)

    if (hasNoRanges) {
      const versionResult = await ludusApi.getVersion()
      if (versionResult.data) {
        setVersion(versionResult.data.result || versionResult.data.version || "")
      }
      setRanges([])
      initialLoadDoneRef.current = true
      if (isInitial) setLoading(false)
      else setRefreshing(false)
      refreshingRef.current = false
      return
    }

    const [rangeResult, versionResult] = await Promise.all([
      ludusApi.getRangeStatus(selectedRangeId ?? undefined),
      ludusApi.getVersion(),
    ])
    if (rangeResult.error) {
      if (rangeResult.status === 400 && !selectedRangeId) {
        setRanges([])
        initialLoadDoneRef.current = true
      } else {
        setError(rangeResult.error)
      }
    } else if (rangeResult.data) {
      applyRangeData(rangeResult.data)
      initialLoadDoneRef.current = true
    }
    if (versionResult.data) {
      setVersion(versionResult.data.result || versionResult.data.version || "")
    }
    if (isInitial) setLoading(false)
    else setRefreshing(false)
    refreshingRef.current = false
  }, [applyRangeData, selectedRangeId, hasNoRanges])

  const silentRefresh = useCallback(async () => {
    if (refreshingRef.current || hasNoRanges) return
    refreshingRef.current = true
    setRefreshing(true)
    const result = await ludusApi.getRangeStatus(selectedRangeId ?? undefined)
    if (!result.error && result.data) {
      applyRangeData(result.data)
    }
    refreshingRef.current = false
    setRefreshing(false)
  }, [applyRangeData, selectedRangeId, hasNoRanges])

  useEffect(() => {
    if (rangeCtxLoading) return

    // The global stream may be for the new range (navigated back while still deploying)
    // or for a different range entirely. Only preserve it when it matches.
    const streamIsForThisRange = isStreaming && streamingRangeId === (selectedRangeId ?? null)
    if (!streamIsForThisRange) {
      stopStreaming()
      clearLogs()
    }
    setShowLogs(streamIsForThisRange)
    setDeploying(streamIsForThisRange)

    initialLoadDoneRef.current = false
    setRanges([])
    setError(null)
    setLoading(true)

    fetchRanges()
    if (!hasNoRanges) {
      const checkDeploy = async () => {
        const r = await ludusApi.getRangeStatus(selectedRangeId ?? undefined)
        if (r.data?.rangeState === "DEPLOYING") {
          setDeploying(true)
          setShowLogs(true)
          // Only start a new stream if one isn't already running for this range
          if (!streamIsForThisRange) startStreaming(selectedRangeId ?? undefined)
        }
      }
      checkDeploy()
    }
    const interval = setInterval(silentRefresh, 15000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRanges, silentRefresh, selectedRangeId, rangeCtxLoading, hasNoRanges])

  // ── Deploy actions ─────────────────────────────────────────────────────────
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
    const result = await ludusApi.abortDeploy(selectedRangeId ?? undefined)
    if (result.error) {
      // Ludus returns this when no ansible process is running but the range is
      // stuck in DEPLOYING state (e.g. after a failed/interrupted GOAD deploy).
      // There is no API call to reset range state without affecting VMs, so we
      // surface a clear message and let the user decide their next action.
      const noProcess =
        typeof result.error === "string" &&
        /no ansible/i.test(result.error)

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
        // Optimistically refresh — Ludus may have self-corrected between abort calls
        fetchRanges()
        return
      }

      toast({ variant: "destructive", title: "Abort failed", description: result.error })
    } else {
      toast({ title: "Deploy aborted" })
      setDeploying(false)
      fetchRanges()
    }
  }
  const handleAbort = () => confirm("Abort the running deployment?", doAbort)

  const doDeleteRange = async (rangeId: string, vmCount: number) => {
    const result = await ludusApi.deleteRange(rangeId)
    if (result.error) {
      toast({ variant: "destructive", title: "Delete failed", description: result.error })
    } else {
      toast({ title: "Range deleted", description: `${rangeId} has been permanently removed` })

      // Refresh the global range context — this updates the sidebar selector and
      // automatically switches away from the deleted range if it was selected.
      await refreshRanges()

      // If the deleted range was active, switch the context explicitly before the
      // local fetchRanges re-renders, so we never hit the "Range not found" error.
      if (rangeId === selectedRangeId) {
        const remaining = accessibleRanges.filter((r) => r.rangeID !== rangeId)
        if (remaining.length > 0) selectRange(remaining[0].rangeID)
      }

      fetchRanges()
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
    const vmNames = (primaryRange?.VMs || (primaryRange as RangeObject & { vms?: VMObject[] })?.vms || [])
      .map((v: VMObject) => v.name || `vm-${v.ID}`)
      .filter(Boolean)
    if (vmNames.length === 0) {
      toast({ variant: "destructive", title: "No VMs", description: "No VMs in this range to power " + action })
      return
    }
    const result = action === "on" ? await ludusApi.powerOn(vmNames, selectedRangeId ?? undefined) : await ludusApi.powerOff(vmNames, selectedRangeId ?? undefined)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: `Powering ${action} all VMs`, description: `${vmNames.length} VMs targeted` })
      setTimeout(fetchRanges, 3000)
    }
  }
  const handlePowerAll = (action: "on" | "off") =>
    confirm(
      action === "on"
        ? `Power ON all VMs in this range?`
        : `Power OFF all VMs in this range?`,
      () => doPowerAll(action)
    )

  // ── Range extras ───────────────────────────────────────────────────────────
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

  // ── Console actions ────────────────────────────────────────────────────────
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

  // ── Derived ────────────────────────────────────────────────────────────────
  const primaryRange = ranges[0] ?? null
  const allVMs = primaryRange?.VMs || primaryRange?.vms || []
  const runningVMs = allVMs.filter((v) => v.poweredOn || v.powerState === "running").length
  const rangeState = primaryRange?.rangeState || "NEVER DEPLOYED"

  const toggleRange = (id: string) => {
    setExpandedRanges((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
          value={loading
            ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            : <Badge className={cn("text-xs", getRangeStateBadge(rangeState))}>{rangeState}</Badge>}
        />
        <StatCard title="Total VMs" icon={<Server className="h-4 w-4 text-blue-400" />}
          value={loading ? "—" : String(allVMs.length)} />
        <StatCard title="Running" icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
          value={loading ? "—" : String(runningVMs)}
          subtext={allVMs.length > 0 ? `${Math.round((runningVMs / allVMs.length) * 100)}% online` : undefined}
        />
        <StatCard title="Ludus Version" icon={<Layers className="h-4 w-4 text-cyan-400" />}
          value={loading ? "—" : (version ? (version.split(" ").pop() || "—") : "—")}
          subtext={version ? version.replace(/\s+\S+$/, "") : "Not connected"}
        />
      </div>

      {/* ── Range accordions ──────────────────────────────────────────────── */}
      {loading ? (
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
          const vms = range.VMs || range.vms || []
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
                          <Wifi className={cn("h-3 w-3", refreshing ? "text-yellow-400 animate-pulse" : "text-green-400")} />
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
                    <Button variant="ghost" size="icon" onClick={fetchRanges} disabled={loading} className="ml-auto">
                      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
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
                      disabled={!!pendingAction || state === "DEPLOYING"}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteRange(range.rangeID || rangeKey, range.name || range.rangeID || rangeKey, vms.length)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete Range
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
                    onRefresh={fetchRanges}
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
