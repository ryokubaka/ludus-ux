"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Server,
  RefreshCw,
  Users,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Terminal,
  KeyRound,
  X,
  UserCog,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { RangeObject, UserObject } from "@/lib/types"
import { cn, getRangeStateBadge } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { IMPERSONATION_CHANGED_EVENT, IMPERSONATION_STORAGE_KEY } from "@/lib/impersonation-context"

interface ImpersonateTarget {
  userID: string
  displayName: string
}

export default function AdminRangesPage() {
  const { toast } = useToast()
  const router = useRouter()
  const [ranges, setRanges] = useState<RangeObject[]>([])
  const [users, setUsers] = useState<UserObject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [impersonateTarget, setImpersonateTarget] = useState<ImpersonateTarget | null>(null)
  const [impersonateApiKey, setImpersonateApiKey] = useState("")
  const [fetchingKey, setFetchingKey] = useState(false)
  const apiKeyInputRef = useRef<HTMLInputElement>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [rangesResult, usersResult] = await Promise.all([
      ludusApi.listAllRanges(),
      ludusApi.listAllUsers(),
    ])
    if (rangesResult.error) {
      setError(rangesResult.error)
    } else if (rangesResult.data) {
      setRanges(Array.isArray(rangesResult.data) ? rangesResult.data : [rangesResult.data])
    }
    if (usersResult.data) {
      setUsers(Array.isArray(usersResult.data) ? usersResult.data : [usersResult.data])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Build userID → user name map
  const userMap: Record<string, string> = {}
  for (const u of users) {
    userMap[u.userID.toLowerCase()] = u.name || u.userID
  }

  /**
   * Attempt to auto-read the user's LUDUS_API_KEY from their ~/.bashrc via root SSH.
   * If found, immediately commit the impersonation and navigate to /goad.
   * If not found, fall back to the manual-entry dialog.
   */
  const startImpersonate = useCallback(async (userID: string, displayName: string) => {
    setFetchingKey(true)
    try {
      const res = await fetch(`/api/admin/fetch-user-apikey?username=${encodeURIComponent(userID)}`)
      const data = await res.json()
      if (data.apiKey) {
        sessionStorage.setItem(
          IMPERSONATION_STORAGE_KEY,
          JSON.stringify({ username: userID, apiKey: data.apiKey })
        )
        // Notify ImpersonationProvider in the same tab to re-read sessionStorage.
        // The native 'storage' event only fires in other tabs, not the current one.
        window.dispatchEvent(new Event(IMPERSONATION_CHANGED_EVENT))
        toast({ title: `Now managing as ${displayName}` })
        router.push("/")
        return
      }
    } catch {
      // SSH error — fall through to manual dialog
    } finally {
      setFetchingKey(false)
    }
    // Fallback: prompt manually
    setImpersonateTarget({ userID, displayName })
    setImpersonateApiKey("")
    setTimeout(() => apiKeyInputRef.current?.focus(), 50)
  }, [router, toast])

  const commitImpersonate = () => {
    if (!impersonateTarget || !impersonateApiKey.trim()) {
      toast({ variant: "destructive", title: "API key required" })
      return
    }
    sessionStorage.setItem(
      IMPERSONATION_STORAGE_KEY,
      JSON.stringify({ username: impersonateTarget.userID, apiKey: impersonateApiKey.trim() })
    )
    window.dispatchEvent(new Event(IMPERSONATION_CHANGED_EVENT))
    toast({ title: `Now managing as ${impersonateTarget.displayName}` })
    setImpersonateTarget(null)
    router.push("/")
  }

  const totalVMs = ranges.reduce((sum, r) => sum + (r.VMs?.length || r.numberOfVMs || 0), 0)
  const deployedRanges = ranges.filter((r) => r.rangeState === "SUCCESS").length
  const deployingRanges = ranges.filter((r) => r.rangeState === "DEPLOYING" || r.rangeState === "WAITING").length

  return (
    <div className="space-y-6">
      {/* Global fetching-key overlay */}
      {fetchingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-72 shadow-2xl border-primary/30 text-center">
            <CardContent className="p-6 flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Reading API key from server…</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Fallback impersonation dialog (shown when auto-read fails) */}
      {impersonateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl border-primary/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" />
                  Manage as <code className="text-primary font-mono">{impersonateTarget.displayName}</code>
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
                  Could not auto-read the API key from <code>~/.bashrc</code>. Enter it manually below.
                  Commands will run via <strong>root SSH</strong> + <code>sudo -u {impersonateTarget.displayName}</code>.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label htmlFor="impersonate-apikey" className="text-xs">
                  {impersonateTarget.displayName}&apos;s Ludus API Key
                </Label>
                <Input
                  id="impersonate-apikey"
                  ref={apiKeyInputRef}
                  type="password"
                  className="font-mono text-xs"
                  placeholder="e.g. USER.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={impersonateApiKey}
                  onChange={(e) => setImpersonateApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitImpersonate()}
                />
                <p className="text-xs text-muted-foreground">
                  Find in their <code className="text-primary">~/.bashrc</code> as{" "}
                  <code className="text-primary">LUDUS_API_KEY</code>, or reset via the Users page.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setImpersonateTarget(null)}>Cancel</Button>
                <Button size="sm" onClick={commitImpersonate} disabled={!impersonateApiKey.trim()}>
                  <Terminal className="h-3.5 w-3.5" />
                  Manage Ludus Ranges
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Ranges", value: ranges.length, icon: <Server className="h-4 w-4 text-primary" /> },
          { label: "Deployed", value: deployedRanges, icon: <CheckCircle2 className="h-4 w-4 text-green-400" /> },
          { label: "Deploying", value: deployingRanges, icon: <Activity className="h-4 w-4 text-yellow-400 animate-pulse" /> },
          { label: "Total VMs", value: totalVMs, icon: <Server className="h-4 w-4 text-blue-400" /> },
        ].map(({ label, value, icon }) => (
          <Card key={label} className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                {icon}
              </div>
              <div className="text-2xl font-bold">{loading ? "—" : value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ranges table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              All Ranges
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : ranges.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No ranges found. Users need to deploy ranges to appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="p-3 w-8"></th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Range ID</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Owner</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">VMs</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Running</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Testing</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Last Deploy</th>
                  </tr>
                </thead>
                <tbody>
                  {ranges.map((range) => {
                    const vms = range.VMs || range.vms || []
                    const runningVMs = vms.filter((v) => v.poweredOn || v.powerState === "running").length
                    const vmCount = vms.length || range.numberOfVMs || 0
                    const owner = range.userID
                      ? (userMap[range.userID.toLowerCase()] || range.userID)
                      : (range.rangeID?.split("-")[0] || "—")
                    const ownerID = range.userID || range.rangeID?.split("-")[0] || "unknown"
                    const lastDeploy = range.lastDeployment
                      ? new Date(range.lastDeployment).toLocaleString([], {
                          month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })
                      : "—"

                    return (
                      <tr key={range.rangeID} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                        <td className="p-3">
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  className="h-6 w-6 text-primary/70 hover:text-primary hover:bg-primary/10"
                                  onClick={() => startImpersonate(ownerID, owner)}
                                >
                                  <UserCog className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-xs">
                                Impersonate {owner}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td className="p-3">
                          <code className="font-mono text-xs text-primary">{range.rangeID || "—"}</code>
                        </td>
                        <td className="p-3 text-xs">{range.name || range.rangeID || "—"}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <Users className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs">{owner}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge className={cn("text-xs", getRangeStateBadge(range.rangeState || "NEVER DEPLOYED"))}>
                            {range.rangeState || "NEVER DEPLOYED"}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{vmCount}</td>
                        <td className="p-3">
                          {vmCount > 0 ? (
                            <span className={cn("text-xs font-medium", runningVMs > 0 ? "text-green-400" : "text-muted-foreground")}>
                              {runningVMs} / {vmCount}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {range.testingEnabled ? (
                            <Badge variant="warning" className="text-xs">On</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Off</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{lastDeploy}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-user range breakdown */}
      {ranges.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ranges.map((range) => {
            const vms = range.VMs || range.vms || []
            const running = vms.filter((v) => v.poweredOn || v.powerState === "running").length
            const state = range.rangeState || "NEVER DEPLOYED"
            const owner = range.userID
              ? (userMap[range.userID.toLowerCase()] || range.userID)
              : (range.rangeID?.split("-")[0] || "unknown")

            return (
              <Card key={range.rangeID} className="glass-card">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5 text-primary" />
                        <code className="font-mono text-xs font-semibold text-primary">{range.rangeID}</code>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {owner}
                      </p>
                    </div>
                    <Badge className={cn("text-xs", getRangeStateBadge(state))}>{state}</Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-xs text-muted-foreground">VMs</p>
                      <p className="font-bold text-sm">{vms.length || range.numberOfVMs || 0}</p>
                    </div>
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-xs text-muted-foreground">Running</p>
                      <p className={cn("font-bold text-sm", running > 0 ? "text-green-400" : "text-muted-foreground")}>
                        {running}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-xs text-muted-foreground">Testing</p>
                      <p className="font-bold text-sm">
                        {range.testingEnabled
                          ? <CheckCircle2 className="h-4 w-4 text-yellow-400 mx-auto" />
                          : <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />}
                      </p>
                    </div>
                  </div>

                  {vms.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">VMs</p>
                      <div className="flex flex-wrap gap-1">
                        {vms.slice(0, 8).map((vm) => (
                          <Badge key={vm.ID} variant="secondary" className={cn(
                            "text-xs font-mono",
                            (vm.poweredOn || vm.powerState === "running") ? "border-green-500/30 text-green-400" : ""
                          )}>
                            {vm.name || `vm-${vm.ID}`}
                          </Badge>
                        ))}
                        {vms.length > 8 && (
                          <Badge variant="secondary" className="text-xs text-muted-foreground">+{vms.length - 8} more</Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => startImpersonate(
                      range.userID || range.rangeID?.split("-")[0] || "unknown",
                      owner
                    )}
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    Manage Ludus Ranges as {owner}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
