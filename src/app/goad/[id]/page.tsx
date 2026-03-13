"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GoadTerminal, useGoadStream } from "@/components/goad/goad-terminal"
import {
  ArrowLeft,
  Terminal,
  Play,
  StopCircle,
  Trash2,
  Power,
  PowerOff,
  Puzzle,
  Plus,
  Loader2,
  RefreshCw,
  Wifi,
  Server,
  CheckCircle2,
  Package,
  Wrench,
  History,
  Clock,
  User,
  RotateCcw,
  FileText,
  Copy,
  Download,
  X,
} from "lucide-react"
import type { GoadInstance, GoadCatalog, GoadExtensionDef, GoadLabDef } from "@/lib/types"
import type { InstanceInventoryFile } from "@/lib/goad-ssh"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useImpersonation } from "@/lib/impersonation-context"

interface TaskSummary {
  id: string
  command: string
  status: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  lineCount: number
}

function formatDuration(startedAt: number, endedAt?: number): string {
  const ms = (endedAt ?? Date.now()) - startedAt
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

export default function GoadInstancePage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const instanceId = decodeURIComponent(params.id as string)
  const storageKey = `goad-task-${instanceId}`

  const [instance, setInstance] = useState<GoadInstance | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const initialInstanceLoadDone = useRef(false)
  // Unified confirmation: holds the label + callback for the pending action
  const [pendingAction, setPendingAction] = useState<{ label: string; fn: () => void } | null>(null)

  const confirm = (label: string, fn: () => void) => setPendingAction({ label, fn })
  const cancelConfirm = () => setPendingAction(null)
  const commitConfirm = () => {
    if (!pendingAction) return
    const fn = pendingAction.fn
    setPendingAction(null)
    fn()
  }
  const { lines, isRunning, exitCode, taskId, run, resumeTask, stop, clear } = useGoadStream(storageKey)
  const [currentAction, setCurrentAction] = useState<string | null>(null)
  const { impersonation, impersonationHeaders } = useImpersonation()
  const [catalog, setCatalog] = useState<GoadCatalog | null>(null)
  const [taskHistory, setTaskHistory] = useState<TaskSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("terminal")
  const [installingExtension, setInstallingExtension] = useState<string | null>(null)
  const [reprovisioningExtension, setReprovisioningExtension] = useState<string | null>(null)
  const [inventories, setInventories] = useState<InstanceInventoryFile[]>([])
  const [inventoriesLoading, setInventoriesLoading] = useState(false)
  const [inventoriesError, setInventoriesError] = useState<string | null>(null)
  const [selectedInventoryName, setSelectedInventoryName] = useState<string | null>(null)

  const fetchInstances = useCallback(async () => {
    const isInitial = !initialInstanceLoadDone.current
    if (isInitial) setLoading(true)
    else setRefreshing(true)
    try {
      const response = await fetch("/api/goad/instances", { headers: impersonationHeaders() })
      const data = await response.json()
      if (!response.ok || data.error) {
        console.warn("GOAD instances fetch error:", data.error)
      } else if (Array.isArray(data.instances)) {
        const found = data.instances.find(
          (i: GoadInstance) => i.instanceId === instanceId
        )
        setInstance(found || null)
        initialInstanceLoadDone.current = true
      }
    } catch (e) {
      console.warn("GOAD instances fetch exception:", e)
    }
    if (isInitial) setLoading(false)
    else setRefreshing(false)
  }, [instanceId, impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchInventories = useCallback(async () => {
    setInventoriesLoading(true)
    setInventoriesError(null)
    try {
      const res = await fetch(
        `/api/goad/instances/${encodeURIComponent(instanceId)}/inventories`,
        { headers: impersonationHeaders() }
      )
      const data = await res.json()
      if (!res.ok) {
        setInventoriesError(data.error || "Failed to load inventories")
        setInventories([])
      } else {
        setInventories(data.inventories ?? [])
        if (data.inventories?.length && !selectedInventoryName) {
          setSelectedInventoryName(data.inventories[0].name)
        }
      }
    } catch (e) {
      setInventoriesError((e as Error).message)
      setInventories([])
    }
    setInventoriesLoading(false)
  }, [instanceId, impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  const copyInventoryToClipboard = (content: string, name: string) => {
    navigator.clipboard.writeText(content).then(
      () => toast({ title: "Copied", description: `${name} copied to clipboard` }),
      () => toast({ title: "Copy failed", variant: "destructive" })
    )
  }

  const downloadInventory = (content: string, name: string) => {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const fetchTaskHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/goad/tasks", { headers: impersonationHeaders() })
      const data = await res.json()
      const allTasks: TaskSummary[] = data.tasks ?? []
      setTaskHistory(allTasks.filter((t) => t.command.includes(instanceId)))
    } catch {}
    setHistoryLoading(false)
  }, [instanceId, impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch instance data and catalog when instanceId changes OR when impersonation changes
  // (fetchInstances is recreated by useCallback when impersonationHeaders changes)
  useEffect(() => {
    fetchInstances()
    fetch("/api/goad/catalog")
      .then((r) => r.json())
      .then((d: GoadCatalog) => { if (d.configured) setCatalog(d) })
      .catch(() => {})
  }, [fetchInstances]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "history") fetchTaskHistory()
  }, [activeTab, fetchTaskHistory])

  /**
   * Run a GOAD command for this instance.
   * CLI-mode tasks (start/stop/destroy/status) use `-i <id> -t <task>`.
   * REPL-only commands (provide, provision_lab, install_extension) use stdin piping.
   * When an impersonation context is active the execute route will use root SSH + sudo.
   */
  const runAction = async (action: string, goadArgs: string) => {
    setCurrentAction(action)
    clear()
    setActiveTab("terminal")
    await run(goadArgs, instanceId, impersonation ?? undefined)
    setCurrentAction(null)
    fetchInstances()
  }

  const handleStart = () =>
    confirm("Start all VMs?", () => runAction("start", `-i ${instanceId} -t start`))
  const handleStop = () =>
    confirm("Stop all VMs?", () => runAction("stop", `-i ${instanceId} -t stop`))
  // `provide` is a REPL command, not a -t task — use REPL mode so LUDUS_API_KEY is injected
  const handleProvide = () =>
    confirm("Provide (create Ludus infrastructure)?", () => runAction("provide", `--repl "use ${instanceId};provide"`))
  const handleProvisionLab = () =>
    confirm("Run full Ansible provisioning? This can take 30–90 minutes.", () =>
      runAction("provision-lab", `--repl "use ${instanceId};provision_lab"`)
    )
  const handleStatus = () => runAction("status", `-i ${instanceId} -t status`)

  const handleInstallExtension = (ext: string) =>
    confirm(`Install extension "${ext}"?`, async () => {
      setInstallingExtension(ext)
      await runAction("install-extension", `--repl "use ${instanceId};install_extension ${ext}"`)
      setInstallingExtension(null)
      toast({ title: "Extension install finished", description: `Review terminal output for ${ext}.` })
    })

  // provision_extension runs Ansible only (no infrastructure changes) — safe to re-run
  const handleReprovisionExtension = (ext: string) =>
    confirm(
      `Re-provision "${ext}"? This re-runs the Ansible playbook without changing infrastructure.`,
      async () => {
        setReprovisioningExtension(ext)
        await runAction("provision-extension", `--repl "use ${instanceId};provision_extension ${ext}"`)
        setReprovisioningExtension(null)
        toast({ title: "Re-provision finished", description: `Review terminal output for ${ext}.` })
      }
    )

  const handleDestroy = () =>
    confirm(`Permanently destroy instance ${instanceId}? This cannot be undone.`, async () => {
      await runAction("destroy", `-i ${instanceId} -t destroy`)
      toast({ title: "Lab destroyed" })
      router.push("/goad")
    })

  const labInfo: GoadLabDef | undefined = catalog?.labs.find((l) => l.name === instance?.lab)
  const extMap: Record<string, GoadExtensionDef> = Object.fromEntries(
    (catalog?.extensions ?? []).map((e) => [e.name, e])
  )
  const uninstalledExtensions: GoadExtensionDef[] = (catalog?.extensions ?? []).filter((ext) => {
    if (instance?.extensions.includes(ext.name)) return false
    if (!instance?.lab) return true
    return ext.compatibility.includes("*") || ext.compatibility.includes(instance.lab)
  })

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/goad"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>Instance &quot;{instanceId}&quot; not found</AlertDescription>
        </Alert>
      </div>
    )
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY": return <Badge variant="success">Ready</Badge>
      case "PROVIDED": return <Badge variant="info">Provided</Badge>
      case "CREATED": return <Badge variant="warning">Created</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getTaskStatusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="success" className="text-xs">Completed</Badge>
      case "running": return <Badge variant="warning" className="text-xs animate-pulse">Running</Badge>
      case "error": return <Badge variant="destructive" className="text-xs">Error</Badge>
      case "aborted": return <Badge variant="secondary" className="text-xs">Aborted</Badge>
      default: return <Badge variant="secondary" className="text-xs">{status}</Badge>
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] gap-6 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href="/goad"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-mono font-bold">{instance.instanceId}</h1>
            <Badge variant="secondary">{instance.lab}</Badge>
            {getStatusBadge(instance.status)}
            {instance.isDefault && <Badge variant="cyan">Default</Badge>}
          </div>
          <div className="flex gap-4 mt-1 flex-wrap">
            {instance.ownerUserId && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> {instance.ownerUserId}
              </span>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Wifi className="h-3 w-3" /> {instance.ipRange || "IP not yet assigned"}
            </span>
            {instance.ludusRangeId ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1" title="Ludus range ID (Proxmox pool)">
                <Server className="h-3 w-3" />
                range: <code className="text-primary ml-0.5">{instance.ludusRangeId}</code>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Server className="h-3 w-3" /> {instance.provider} / {instance.provisioner}
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={fetchInstances} disabled={loading || refreshing}>
          <RefreshCw className={cn("h-4 w-4", (loading || refreshing) && "animate-spin")} />
        </Button>
      </div>

      {/* Actions */}
      <Card className="flex-shrink-0">
        <CardContent className="p-3 space-y-2">
          {/* ── Confirmation bar ───────────────────────────────────────────── */}
          {pendingAction && (
            <div className="flex items-center gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2">
              <span className="text-xs text-yellow-300 flex-1">{pendingAction.label}</span>
              <Button size="sm" variant="default" onClick={commitConfirm}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelConfirm}>
                Cancel
              </Button>
            </div>
          )}

          {/* ── Action buttons ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm" variant="outline"
                onClick={handleProvide} disabled={isRunning || !!pendingAction}
                title="Deploy/update Ludus infrastructure (no Ansible)"
              >
                {isRunning && currentAction === "provide"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Server className="h-3.5 w-3.5" />}
                Provide
              </Button>
              <Button
                size="sm" variant="success"
                onClick={handleProvisionLab} disabled={isRunning || !!pendingAction}
                title="Run all Ansible playbooks to configure the lab"
              >
                {isRunning && currentAction === "provision-lab"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Wrench className="h-3.5 w-3.5" />}
                Provision Lab
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleStart} disabled={isRunning || !!pendingAction}
                title="Power on all VMs"
              >
                {isRunning && currentAction === "start"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Power className="h-3.5 w-3.5" />}
                Start All
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleStop} disabled={isRunning || !!pendingAction}
                title="Power off all VMs"
              >
                {isRunning && currentAction === "stop"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PowerOff className="h-3.5 w-3.5" />}
                Stop All
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleStatus} disabled={isRunning || !!pendingAction}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Status
              </Button>
            </div>

            {isRunning && (
              <Button size="sm" variant="destructive" onClick={stop}>
                <StopCircle className="h-3.5 w-3.5" />
                Stop Command
              </Button>
            )}

            <div className="flex-1" />

            <Button
              size="sm" variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={handleDestroy} disabled={isRunning || !!pendingAction}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Destroy
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs — flex-1 so terminal tab can fill remaining height */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList>
          <TabsTrigger value="terminal">
            <Terminal className="h-3.5 w-3.5 mr-1.5" />
            Terminal
            {isRunning && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-green-400 animate-pulse inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger value="info">
            <Server className="h-3.5 w-3.5 mr-1.5" />
            Lab Info
          </TabsTrigger>
          <TabsTrigger value="inventories" onClick={() => inventories.length === 0 && !inventoriesLoading && fetchInventories()}>
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Inventories
            {inventories.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">({inventories.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="extensions">
            <Puzzle className="h-3.5 w-3.5 mr-1.5" />
            Extensions ({instance.extensions.length})
          </TabsTrigger>
          <TabsTrigger value="history" onClick={fetchTaskHistory}>
            <History className="h-3.5 w-3.5 mr-1.5" />
            Logs History
          </TabsTrigger>
        </TabsList>

        {/* Terminal */}
        <TabsContent value="terminal" className="mt-4 flex flex-col min-h-0 flex-1">
          {isRunning && (
            <div className="flex items-center gap-2 mb-3 flex-shrink-0">
              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm text-green-400">Running: {currentAction}</span>
            </div>
          )}
          {lines.length === 0 && !isRunning && (
            <p className="text-xs text-muted-foreground mb-3 flex-shrink-0">
              Use the action buttons above to run GOAD commands. Output will appear here and persist if you navigate away.
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
                Command exited with code {exitCode}{exitCode === 0 ? " ✓" : " ✗"}
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Lab Info */}
        <TabsContent value="info" className="mt-4">
          <div className="space-y-4">
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">GOAD compiled inventories</p>
                    <p className="text-xs text-muted-foreground">
                      Base inventory and extension inventories for this instance (workspace/{instanceId})
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setActiveTab("inventories")
                    if (inventories.length === 0 && !inventoriesLoading) fetchInventories()
                  }}
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  View inventories
                </Button>
              </CardContent>
            </Card>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Lab Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ["Lab", instance.lab],
                  ["Instance ID", instance.instanceId],
                  ["Status", instance.status],
                  ["IP Range", instance.ipRange || "Not assigned"],
                  ["Provider", instance.provider],
                  ["Provisioner", instance.provisioner],
                ].map(([key, val]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground text-xs">{key}</span>
                    <code className="font-mono text-xs">{val}</code>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Lab Description</CardTitle>
              </CardHeader>
              <CardContent>
                {labInfo ? (
                  <div className="space-y-2">
                    {labInfo.description && (
                      <p className="text-xs text-muted-foreground">{labInfo.description}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="text-center p-2 bg-muted/50 rounded-md">
                        <p className="text-lg font-bold">{labInfo.vmCount}</p>
                        <p className="text-xs text-muted-foreground">VMs</p>
                      </div>
                      <div className="text-center p-2 bg-muted/50 rounded-md">
                        <p className="text-lg font-bold">{labInfo.domains}</p>
                        <p className="text-xs text-muted-foreground">Domains</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No description available</p>
                )}
              </CardContent>
            </Card>
          </div>
          </div>
        </TabsContent>

        {/* Compiled inventories (base + extension inventories from workspace) */}
        <TabsContent value="inventories" className="mt-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Inventory files in <code className="text-primary">workspace/{instanceId}</code> (base + each extension).
              </p>
              <Button size="sm" variant="ghost" onClick={fetchInventories} disabled={inventoriesLoading}>
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", inventoriesLoading && "animate-spin")} />
                {inventoriesLoading ? "Loading..." : "Refresh"}
              </Button>
            </div>
            {inventoriesError && (
              <Alert variant="destructive">
                <AlertDescription>{inventoriesError}</AlertDescription>
              </Alert>
            )}
            {inventoriesLoading && inventories.length === 0 ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : inventories.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No inventory files found. Run Provide to create the workspace.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 space-y-1">
                  {inventories.map((inv) => (
                    <Button
                      key={inv.name}
                      variant={selectedInventoryName === inv.name ? "secondary" : "ghost"}
                      size="sm"
                      className="w-full justify-start font-mono text-xs"
                      onClick={() => setSelectedInventoryName(inv.name)}
                    >
                      <FileText className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
                      {inv.name}
                    </Button>
                  ))}
                </div>
                <div className="md:col-span-2">
                  {selectedInventoryName && (() => {
                    const inv = inventories.find((i) => i.name === selectedInventoryName)
                    if (!inv) return null
                    return (
                      <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-mono">{inv.name}</CardTitle>
                          <div className="flex gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Copy"
                              onClick={() => copyInventoryToClipboard(inv.content, inv.name)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Download"
                              onClick={() => downloadInventory(inv.content, inv.name)}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          <pre className="p-3 text-xs font-mono overflow-auto max-h-[60vh] bg-muted/30 rounded-b-lg whitespace-pre-wrap break-all">
                            {inv.content || "(empty)"}
                          </pre>
                        </CardContent>
                      </Card>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Extensions */}
        <TabsContent value="extensions" className="mt-4">
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="text-xs">
                <strong>Install</strong> runs providing + Ansible for a new extension.{" "}
                <strong>Re-provision</strong> re-runs only the Ansible playbook for an already-installed
                extension — use this to re-apply config or fix a failed provisioning without touching
                infrastructure. Both require <code className="text-primary">Provide</code> to have run first.
              </AlertDescription>
            </Alert>
            {instance.extensions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Installed</p>
                <div className="grid gap-2">
                  {instance.extensions.map((ext) => (
                    <div
                      key={ext}
                      className="flex items-center justify-between p-3 rounded-lg border border-green-500/30 bg-green-500/5"
                    >
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
                        <div>
                          <code className="font-mono text-sm text-green-400">{ext}</code>
                          {extMap[ext]?.description && (
                            <p className="text-xs text-muted-foreground">{extMap[ext].description}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground flex-shrink-0"
                        onClick={() => handleReprovisionExtension(ext)}
                        disabled={isRunning || !!pendingAction || instance.status === "CREATED"}
                        title="Re-run Ansible provisioning for this extension (no infrastructure changes)"
                      >
                        {reprovisioningExtension === ext ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        {reprovisioningExtension === ext ? "Running..." : "Re-provision"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uninstalledExtensions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Available to Install</p>
                <div className="grid gap-2">
                  {uninstalledExtensions.map((ext) => (
                    <div
                      key={ext.name}
                      className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/30"
                    >
                      <div className="flex items-center gap-3">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <code className="font-mono text-sm">{ext.name}</code>
                          {ext.description && (
                            <p className="text-xs text-muted-foreground">{ext.description}</p>
                          )}
                          {ext.machines.length > 0 && (
                            <p className="text-xs text-muted-foreground/60">
                              +{ext.machines.length} VM{ext.machines.length !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleInstallExtension(ext.name)}
                        disabled={isRunning || !!pendingAction || instance.status === "CREATED"}
                        title={instance.status === "CREATED" ? "Run Provide before installing extensions" : "Install extension"}
                      >
                        {installingExtension === ext.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        {installingExtension === ext.name ? "Installing..." : "Install"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {instance.extensions.length === 0 && uninstalledExtensions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No extensions available for this lab
              </p>
            )}
          </div>
        </TabsContent>

        {/* Task History */}
        <TabsContent value="history" className="mt-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              GOAD operations run for this instance — output persists on the server.
            </p>
            <Button size="sm" variant="ghost" onClick={fetchTaskHistory} disabled={historyLoading}>
              <RefreshCw className={cn("h-3.5 w-3.5", historyLoading && "animate-spin")} />
            </Button>
          </div>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : taskHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No recorded operations for this instance yet
            </div>
          ) : (
            <div className="space-y-2">
              {taskHistory.map((task) => (
                <Card
                  key={task.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => {
                    clear()
                    resumeTask(task.id)
                    setActiveTab("terminal")
                  }}
                >
                  <CardContent className="p-3 flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <code className="font-mono text-xs text-primary truncate block">
                        {task.command}
                      </code>
                      <div className="flex gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground">{timeAgo(task.startedAt)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(task.startedAt, task.endedAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">{task.lineCount} lines</span>
                      </div>
                    </div>
                    {getTaskStatusBadge(task.status)}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
