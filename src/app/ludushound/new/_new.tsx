"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { useRange } from "@/lib/range-context"
import { useImpersonation } from "@/lib/impersonation-context"
import { ludusApi } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import {
  DEFAULT_NEO4J_PASS,
  DEFAULT_NEO4J_USER,
} from "@/lib/ludushound-wizard-args"
import type { LudushoundStatus, TemplateObject } from "@/lib/types"
import type { TemplateAuditSummary } from "@/lib/ludushound-templates"
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react"

const STEPS = [
  "Mode",
  "BloodHound source",
  "Targets",
  "Range",
  "Review & Deploy",
] as const

type Mode = "full" | "attackpath"
type BhSource = "external" | "filesmap"

export function NewLudushoundPageClient() {
  const router = useRouter()
  const { toast } = useToast()
  const scopeTag = useEffectiveScopeTag()
  const { ranges, selectRange, refreshRanges } = useRange()
  const { impersonationHeaders } = useImpersonation()

  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<Mode>("attackpath")
  const [bhSource, setBhSource] = useState<BhSource>("external")
  const [localRoles, setLocalRoles] = useState(false)

  const [server, setServer] = useState("")
  const [neoUser, setNeoUser] = useState(DEFAULT_NEO4J_USER)
  const [neoPass, setNeoPass] = useState(DEFAULT_NEO4J_PASS)
  const [aliveComputers, setAliveComputers] = useState("")
  const [filesMapContent, setFilesMapContent] = useState("")
  const [attackPathContent, setAttackPathContent] = useState("")
  const [domainController, setDomainController] = useState("")

  const [rangeMode, setRangeMode] = useState<"new" | "existing">("new")
  const [newRangeId, setNewRangeId] = useState("")
  const [existingRangeId, setExistingRangeId] = useState("")

  const [busy, setBusy] = useState<string | null>(null)
  const [probeDetail, setProbeDetail] = useState<string | null>(null)
  const [generatedYaml, setGeneratedYaml] = useState("")
  const [workspaceId, setWorkspaceId] = useState("")
  const [templatesReady, setTemplatesReady] = useState(false)
  const [templateAudit, setTemplateAudit] = useState<TemplateAuditSummary | null>(null)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [generateStdout, setGenerateStdout] = useState("")

  const statusQuery = useQuery({
    queryKey: queryKeys.ludushoundStatusScoped(scopeTag),
    queryFn: async (): Promise<LudushoundStatus> => {
      const res = await fetch("/api/ludushound/status", { headers: { ...impersonationHeaders } })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "status failed")
      return data
    },
    staleTime: STALE.short,
  })

  const templatesQuery = useQuery({
    queryKey: [...queryKeys.ludushoundStatusScoped(scopeTag), "templates"],
    queryFn: async () => {
      const res = await ludusApi.listTemplates()
      return (res.data || []) as TemplateObject[]
    },
    staleTime: STALE.medium,
  })

  const builtNames = useMemo(() => {
    const s = new Set<string>()
    for (const t of templatesQuery.data || []) {
      if (t.built) s.add(t.name)
    }
    return s
  }, [templatesQuery.data])

  const allNames = useMemo(() => {
    const s = new Set<string>()
    for (const t of templatesQuery.data || []) s.add(t.name)
    return s
  }, [templatesQuery.data])

  const effectiveRangeId = rangeMode === "new" ? newRangeId.trim() : existingRangeId.trim()
  const skipBhStep = mode === "attackpath"

  const visibleSteps = useMemo(() => {
    if (skipBhStep) return STEPS.filter((s) => s !== "BloodHound source")
    return [...STEPS]
  }, [skipBhStep])

  const stepLabel = visibleSteps[step] || STEPS[0]

  const goNext = () => setStep((s) => Math.min(s + 1, visibleSteps.length - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  const ensureRange = async (): Promise<string> => {
    if (rangeMode === "existing") {
      if (!existingRangeId.trim()) throw new Error("Select an existing range")
      return existingRangeId.trim()
    }
    const id = newRangeId.trim()
    if (!id) throw new Error("Enter a new range ID")
    const created = await ludusApi.createRange({ name: id, rangeID: id })
    if (created.error && !/already exists/i.test(created.error)) {
      throw new Error(created.error)
    }
    await refreshRanges()
    selectRange(id)
    return id
  }

  const probeNeo4j = async () => {
    setBusy("probe")
    setProbeDetail(null)
    try {
      const res = await fetch("/api/ludushound/probe-neo4j", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...impersonationHeaders },
        body: JSON.stringify({ server, user: neoUser, pass: neoPass }),
      })
      const data = await res.json()
      setProbeDetail(data.detail || (data.ok ? "OK" : data.error))
      if (!data.ok) throw new Error(data.detail || data.error || "Probe failed")
      toast({ title: "Neo4j reachable", description: data.detail })
    } catch (err) {
      toast({ title: "Probe failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const installCollection = async () => {
    setBusy("collection")
    try {
      const res = await fetch("/api/ludushound/install-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...impersonationHeaders },
        body: JSON.stringify({ buildBinary: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Install failed")
      toast({ title: "Collection ready", description: data.detail })
      await statusQuery.refetch()
    } catch (err) {
      toast({ title: "Install failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const generate = async () => {
    setBusy("generate")
    setTemplatesError(null)
    try {
      const rangeId = await ensureRange()
      const payload: Record<string, unknown> = {
        mode,
        rangeId,
        localRoles,
      }
      if (mode === "attackpath") {
        payload.attackPathContent = attackPathContent
        payload.domainController = domainController
      } else if (bhSource === "filesmap") {
        payload.bloodhoundSource = "filesmap"
        payload.filesMapJsonContent = filesMapContent
        payload.aliveComputers = aliveComputers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      } else {
        payload.bloodhoundSource = bhSource
        payload.server = server
        payload.user = neoUser
        payload.pass = neoPass
        payload.aliveComputers = aliveComputers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      }

      const res = await fetch("/api/ludushound/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...impersonationHeaders },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || data.stderr || "Generate failed")
      }
      setGeneratedYaml(data.yaml || "")
      setWorkspaceId(data.workspaceId || "")
      setTemplatesReady(!!data.templatesReady)
      setTemplateAudit(data.templateAudit || null)
      setTemplatesError(data.templatesError || null)
      setGenerateStdout(data.stdout || "")
      toast({ title: "YAML generated", description: `Workspace ${data.workspaceId}` })
      // jump to last step
      setStep(visibleSteps.length - 1)
    } catch (err) {
      toast({ title: "Generate failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const deploy = async () => {
    if (!generatedYaml.trim()) {
      toast({ title: "Generate YAML first", variant: "destructive" })
      return
    }
    setBusy("deploy")
    try {
      const rangeId = await ensureRange()
      const res = await fetch("/api/ludushound/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...impersonationHeaders },
        body: JSON.stringify({
          rangeId,
          yaml: generatedYaml,
          workspaceId,
          localRoles,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Deploy failed")
      selectRange(rangeId)
      toast({ title: "Deploy started", description: `Range ${rangeId}` })
      router.push("/")
    } catch (err) {
      toast({ title: "Deploy failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const canProceedFromTargets = () => {
    if (mode === "attackpath") {
      return !!attackPathContent.trim() && domainController.includes(".")
    }
    if (bhSource === "filesmap") {
      return !!filesMapContent.trim() && aliveComputers.includes(".")
    }
    return !!server.trim() && aliveComputers.includes(".")
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/ludushound">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Deploy LudusHound range</h1>
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <a
              href="https://github.com/bagelByt3s/LudusHound"
              className="text-primary underline inline-flex items-center gap-1"
              target="_blank"
              rel="noreferrer"
            >
              LudusHound
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleSteps.map((label, i) => (
          <Badge
            key={label}
            variant={i === step ? "default" : i < step ? "secondary" : "outline"}
            className="cursor-pointer"
            onClick={() => setStep(i)}
          >
            {i + 1}. {label}
          </Badge>
        ))}
      </div>

      {stepLabel === "Mode" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deployment mode</CardTitle>
            <CardDescription>Full AD replica from BloodHound, or a single Attack Path export.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className={cn(
                "rounded-lg border p-4 text-left transition",
                mode === "full" ? "border-primary bg-primary/5" : "border-border",
              )}
              onClick={() => setMode("full")}
            >
              <p className="font-medium">Full AD replica</p>
              <p className="text-xs text-muted-foreground mt-1">
                Neo4j / FilesMap + AliveComputers → full LudusHound roles
              </p>
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg border p-4 text-left transition",
                mode === "attackpath" ? "border-primary bg-primary/5" : "border-border",
              )}
              onClick={() => setMode("attackpath")}
            >
              <p className="font-medium">Attack Path</p>
              <p className="text-xs text-muted-foreground mt-1">
                BloodHound Export JSON + Domain Controller → lean path lab
              </p>
            </button>
            <div className="sm:col-span-2 flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <p className="text-sm font-medium">LocalRoles</p>
                <p className="text-xs text-muted-foreground">
                  Use roles from install-roles.sh instead of bagelByt3s.ludushound collection FQCNs
                </p>
              </div>
              <Switch checked={localRoles} onCheckedChange={setLocalRoles} />
            </div>
          </CardContent>
        </Card>
      )}

      {stepLabel === "BloodHound source" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">BloodHound source</CardTitle>
            <CardDescription>
              Live Neo4j must already hold SharpHound data (or use FilesMap / Attack Path).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(["external", "filesmap"] as BhSource[]).map((src) => (
              <button
                key={src}
                type="button"
                className={cn(
                  "w-full rounded-lg border p-4 text-left transition",
                  bhSource === src ? "border-primary bg-primary/5" : "border-border",
                )}
                onClick={() => setBhSource(src)}
              >
                <p className="font-medium capitalize">{src === "filesmap" ? "FilesMapJson (offline)" : src}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {src === "external" && "Existing Neo4j reachable from the Ludus host (:7474)."}
                  {src === "filesmap" && "Reuse a prior LudusHound filesMap.json dump — no live Neo4j."}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {stepLabel === "Targets" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {mode === "attackpath" ? "Attack Path inputs" : "AD replica inputs"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === "attackpath" ? (
              <>
                <div className="space-y-1.5">
                  <Label>DomainController FQDN</Label>
                  <Input
                    className="font-mono text-xs"
                    placeholder="TITAN.GHOST.LOCAL"
                    value={domainController}
                    onChange={(e) => setDomainController(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Attack Path JSON (BloodHound Export)</Label>
                  <Textarea
                    className="font-mono text-xs min-h-[180px]"
                    placeholder='Paste graph.json…'
                    value={attackPathContent}
                    onChange={(e) => setAttackPathContent(e.target.value)}
                  />
                </div>
              </>
            ) : bhSource === "filesmap" ? (
              <>
                <div className="space-y-1.5">
                  <Label>AliveComputers (comma-separated FQDNs)</Label>
                  <Input
                    className="font-mono text-xs"
                    value={aliveComputers}
                    onChange={(e) => setAliveComputers(e.target.value)}
                    placeholder="DC01.GHOST.LOCAL,WS01.GHOST.LOCAL"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>filesMap.json content</Label>
                  <Textarea
                    className="font-mono text-xs min-h-[180px]"
                    value={filesMapContent}
                    onChange={(e) => setFilesMapContent(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label>Neo4j host</Label>
                    <Input
                      className="font-mono text-xs"
                      value={server}
                      onChange={(e) => setServer(e.target.value)}
                      placeholder="10.x.x.x"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>User</Label>
                    <Input
                      className="font-mono text-xs"
                      value={neoUser}
                      onChange={(e) => setNeoUser(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <Input
                      type="password"
                      className="font-mono text-xs"
                      value={neoPass}
                      onChange={(e) => setNeoPass(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!server.trim() || busy !== null}
                  onClick={() => void probeNeo4j()}
                >
                  {busy === "probe" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Probe Neo4j from Ludus host
                </Button>
                {probeDetail && <p className="text-xs text-muted-foreground">{probeDetail}</p>}
                <div className="space-y-1.5">
                  <Label>AliveComputers (comma-separated FQDNs → VMs)</Label>
                  <Input
                    className="font-mono text-xs"
                    value={aliveComputers}
                    onChange={(e) => setAliveComputers(e.target.value)}
                    placeholder="DC01.GHOST.LOCAL,WS01.GHOST.LOCAL"
                  />
                  <p className="text-xs text-muted-foreground">
                    Which BloodHound <code className="text-[11px]">Computer</code> nodes become Ludus VMs.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {stepLabel === "Range" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ludus range</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={rangeMode === "new" ? "default" : "outline"}
                onClick={() => setRangeMode("new")}
              >
                New range
              </Button>
              <Button
                size="sm"
                variant={rangeMode === "existing" ? "default" : "outline"}
                onClick={() => setRangeMode("existing")}
              >
                Existing range
              </Button>
            </div>
            {rangeMode === "new" ? (
              <div className="space-y-1.5">
                <Label>Range ID</Label>
                <Input
                  className="font-mono text-xs"
                  value={newRangeId}
                  onChange={(e) => setNewRangeId(e.target.value)}
                  placeholder="my-ludushound"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Select range</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  value={existingRangeId}
                  onChange={(e) => setExistingRangeId(e.target.value)}
                >
                  <option value="">—</option>
                  {ranges.map((r) => (
                    <option key={r.rangeID} value={r.rangeID}>
                      {r.rangeID}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {stepLabel === "Review & Deploy" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review & Deploy</CardTitle>
            <CardDescription>
              Generate Ludus YAML with LudusHound, verify Packer templates, then deploy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {!statusQuery.data?.collectionInstalled && !localRoles && (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void installCollection()}>
                  {busy === "collection" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Install LudusHound collection
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy !== null || !effectiveRangeId || !canProceedFromTargets()}
                onClick={() => void generate()}
              >
                {busy === "generate" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Generate YAML
              </Button>
              <Button
                size="sm"
                disabled={
                  busy !== null ||
                  !generatedYaml.trim() ||
                  !templatesReady ||
                  (!localRoles && !statusQuery.data?.collectionInstalled)
                }
                onClick={() => void deploy()}
              >
                {busy === "deploy" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Deploy range
              </Button>
            </div>

            {templateAudit && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  Templates
                  {templatesReady ? (
                    <CheckCircle2 className="h-4 w-4 text-status-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-status-error" />
                  )}
                </p>
                <div className="flex flex-wrap gap-1">
                  {templateAudit.required.map((t) => {
                    const built = builtNames.has(t)
                    const installed = allNames.has(t)
                    return (
                      <span
                        key={t}
                        className={cn(
                          "inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono border",
                          built
                            ? "bg-status-success/10 border-status-success/30 text-status-success"
                            : installed
                              ? "bg-yellow-500/10 border-yellow-500/30 text-status-warning"
                              : "bg-status-error/10 border-status-error/30 text-status-error",
                        )}
                      >
                        {t}
                      </span>
                    )
                  })}
                </div>
                {templatesError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">{templatesError}</AlertDescription>
                  </Alert>
                )}
                {!templatesReady && (
                  <p className="text-xs text-muted-foreground">
                    Build missing templates on{" "}
                    <Link href="/templates" className="text-primary underline">
                      /templates
                    </Link>{" "}
                    before deploy.
                  </p>
                )}
              </div>
            )}

            {generateStdout && (
              <pre className="text-[11px] font-mono max-h-32 overflow-auto rounded border bg-muted/40 p-2 whitespace-pre-wrap">
                {generateStdout}
              </pre>
            )}

            <div className="space-y-1.5">
              <Label>Generated YAML {workspaceId ? `(${workspaceId})` : ""}</Label>
              <Textarea
                className="font-mono text-xs min-h-[280px]"
                value={generatedYaml}
                onChange={(e) => {
                  setGeneratedYaml(e.target.value)
                  setTemplatesReady(false)
                }}
                placeholder="Click Generate YAML…"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" size="sm" disabled={step === 0} onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        {stepLabel !== "Review & Deploy" ? (
          <Button
            size="sm"
            onClick={goNext}
            disabled={
              (stepLabel === "Targets" && !canProceedFromTargets()) ||
              (stepLabel === "Range" && !effectiveRangeId)
            }
          >
            Next
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
