"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { LogViewer } from "@/components/range/log-viewer"
import {
  BookTemplate,
  RefreshCw,
  Play,
  StopCircle,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  Plus,
  Download,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  AlertTriangle,
  Check,
  Monitor,
  Apple,
  HelpCircle,
} from "lucide-react"
import { ludusApi, del } from "@/lib/api"
import type { TemplateObject } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"

// ── Template source types ─────────────────────────────────────────────────────

interface SourceTemplate {
  name:    string
  path:    string
  files:   string[]
  apiBase: string
  ref:     string
}

const BUILTIN_SOURCE = {
  label: "badsectorlabs/ludus (official)",
  url:   "https://gitlab.com/badsectorlabs/ludus/-/tree/main/templates",
  value: "badsectorlabs",
}

// ── Add from Source panel ─────────────────────────────────────────────────────

function AddFromSource({ installedNames, onAdded }: {
  installedNames: Set<string>
  onAdded: () => void
}) {
  const { toast } = useToast()
  const [open,              setOpen]              = useState(false)
  const [sourceValue,       setSourceValue]       = useState("badsectorlabs")
  const [customRepoUrl,     setCustomRepoUrl]     = useState("")
  const [customPath,        setCustomPath]        = useState("templates")
  const [customRef,         setCustomRef]         = useState("main")
  const [sourceTemplates,   setSourceTemplates]   = useState<SourceTemplate[]>([])
  const [loadingSource,     setLoadingSource]     = useState(false)
  const [sourceError,       setSourceError]       = useState<string | null>(null)
  const [selected,          setSelected]          = useState<Set<string>>(new Set())
  const [adding,            setAdding]            = useState(false)
  const [addResults,        setAddResults]        = useState<{name:string;success:boolean;message:string}[]>([])

  const fetchSource = useCallback(async () => {
    setLoadingSource(true)
    setSourceError(null)
    setSourceTemplates([])
    setSelected(new Set())
    setAddResults([])
    try {
      const params = new URLSearchParams({ source: sourceValue })
      if (sourceValue === "custom" && customRepoUrl) {
        // Derive GitLab API base from a repo browse URL like:
        // https://gitlab.com/owner/repo/-/tree/ref/path
        // → https://gitlab.com/api/v4/projects/owner%2Frepo/repository
        let apiBase = customRepoUrl
        const glMatch = customRepoUrl.match(/^https:\/\/gitlab\.com\/([^/]+\/[^/]+?)(?:\/|$)/)
        if (glMatch) {
          apiBase = `https://gitlab.com/api/v4/projects/${encodeURIComponent(glMatch[1])}/repository`
        }
        params.set("source",  "custom")
        params.set("repoUrl", apiBase)
        params.set("path",    customPath)
        params.set("ref",     customRef)
      }
      const res  = await fetch(`/api/templates/sources?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSourceTemplates(data.templates ?? [])
    } catch (err) {
      setSourceError((err as Error).message)
    } finally {
      setLoadingSource(false)
    }
  }, [sourceValue, customRepoUrl, customPath, customRef])

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAdd = async () => {
    if (selected.size === 0) return
    setAdding(true)
    setAddResults([])
    try {
      const toAdd = sourceTemplates
        .filter((t) => selected.has(t.name))
        .map(({ name, path, apiBase, ref }) => ({ name, path, apiBase, ref }))

      const res  = await fetch("/api/templates/add", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ templates: toAdd }),
      })
      const data = await res.json()
      const results: {name:string;success:boolean;message:string}[] = data.results ?? []
      setAddResults(results)

      const ok  = results.filter((r) => r.success).length
      const err = results.filter((r) => !r.success).length
      if (ok > 0)  toast({ title: `${ok} template${ok > 1 ? "s" : ""} added`, description: "You can now build them from the list above." })
      if (err > 0) toast({ variant: "destructive", title: `${err} template${err > 1 ? "s" : ""} failed`, description: "See details below." })
      if (ok > 0) {
        setSelected(new Set())
        onAdded()
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Add failed", description: (err as Error).message })
    } finally {
      setAdding(false)
    }
  }

  // Available = in source but NOT already added to Ludus
  const available = sourceTemplates.filter((t) => !installedNames.has(t.name))
  const alreadyIn = sourceTemplates.filter((t) => installedNames.has(t.name))

  return (
    <Card>
      <button className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <CardHeader className="pb-3 hover:bg-muted/20 transition-colors">
          <CardTitle className="text-sm flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <GitBranch className="h-4 w-4 text-primary" />
            Add Templates from Source
            <span className="text-xs text-muted-foreground font-normal">
              — install community or official templates not bundled with Ludus
            </span>
          </CardTitle>
        </CardHeader>
      </button>

      {open && (
        <CardContent className="space-y-4">
          {/* Source selector */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground mb-1 block">Source</label>
              <div className="flex gap-2">
                {["badsectorlabs", "custom"].map((v) => (
                  <button
                    key={v}
                    onClick={() => { setSourceValue(v); setSourceTemplates([]); setAddResults([]) }}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs border transition-colors",
                      sourceValue === v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-transparent text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {v === "badsectorlabs" ? "badsectorlabs/ludus (official)" : "Custom GitLab repo"}
                  </button>
                ))}
              </div>
            </div>

            {sourceValue === "badsectorlabs" && (
              <a
                href={BUILTIN_SOURCE.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                View on GitLab
              </a>
            )}
          </div>

          {/* Custom repo fields */}
          {sourceValue === "custom" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3">
                <label className="text-xs text-muted-foreground mb-1 block">GitLab repo URL</label>
                <Input
                  placeholder="https://gitlab.com/owner/repo"
                  value={customRepoUrl}
                  onChange={(e) => setCustomRepoUrl(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Templates path</label>
                <Input
                  placeholder="templates"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Branch / ref</label>
                <Input
                  placeholder="main"
                  value={customRef}
                  onChange={(e) => setCustomRef(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </div>
          )}

          {/* Fetch button */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={fetchSource} disabled={loadingSource}>
              {loadingSource
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              {loadingSource ? "Loading…" : "Fetch Available Templates"}
            </Button>

            {sourceTemplates.length > 0 && (
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={selected.size === 0 || adding}
              >
                {adding
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                {adding ? "Adding…" : `Add Selected (${selected.size})`}
              </Button>
            )}
          </div>

          {sourceError && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {sourceError}
            </div>
          )}

          {/* Available templates grid */}
          {available.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Available to Add ({available.length})
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {available.map((t) => {
                  const result = addResults.find((r) => r.name === t.name)
                  return (
                    <button
                      key={t.name}
                      onClick={() => toggleSelect(t.name)}
                      className={cn(
                        "text-left rounded-lg border p-3 text-xs transition-colors",
                        selected.has(t.name)
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          type="checkbox"
                          className="rounded shrink-0"
                          checked={selected.has(t.name)}
                          onChange={() => toggleSelect(t.name)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <code className="font-mono font-medium text-primary truncate">{t.name}</code>
                        {result && (
                          result.success
                            ? <Check className="h-3 w-3 text-green-400 ml-auto shrink-0" />
                            : <XCircle className="h-3 w-3 text-destructive ml-auto shrink-0" />
                        )}
                      </div>
                      <p className="text-muted-foreground/70 truncate pl-5">
                        {t.files.find((f) => f.endsWith(".pkr.hcl") || f.endsWith(".pkr.json")) ?? t.files[0] ?? ""}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Already installed list */}
          {alreadyIn.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Already in Ludus ({alreadyIn.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {alreadyIn.map((t) => (
                  <Badge key={t.name} variant="secondary" className="text-xs font-mono gap-1">
                    <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />
                    {t.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Per-template add results */}
          {addResults.length > 0 && (
            <div className="space-y-1">
              {addResults.map((r) => (
                <div
                  key={r.name}
                  className={cn(
                    "flex items-start gap-2 text-xs rounded px-3 py-2",
                    r.success ? "bg-green-500/10 text-green-400" : "bg-destructive/10 text-destructive"
                  )}
                >
                  {r.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                  <div>
                    <span className="font-mono font-medium">{r.name}</span>
                    {r.message && <span className="ml-2 opacity-80">{r.message}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sourceTemplates.length === 0 && !loadingSource && !sourceError && (
            <p className="text-xs text-muted-foreground/60 text-center py-4">
              Click &quot;Fetch Available Templates&quot; to browse templates from the selected source.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ── OS badge ─────────────────────────────────────────────────────────────────

type LudusOS = "linux" | "windows" | "macos" | "other"

function OsBadge({ os }: { os?: LudusOS }) {
  if (!os) return null
  const map: Record<LudusOS, { icon: React.ReactNode; label: string; cls: string }> = {
    linux:   { icon: <Monitor className="h-3 w-3" />,    label: "Linux",   cls: "text-yellow-400" },
    windows: { icon: <Monitor className="h-3 w-3" />,    label: "Windows", cls: "text-blue-400" },
    macos:   { icon: <Apple className="h-3 w-3" />,      label: "macOS",   cls: "text-muted-foreground" },
    other:   { icon: <HelpCircle className="h-3 w-3" />, label: "Other",   cls: "text-muted-foreground" },
  }
  const { icon, label, cls } = map[os] ?? map.other
  return (
    <span className={cn("flex items-center gap-1 text-xs font-mono", cls)}>
      {icon}
      {label}
    </span>
  )
}

export default function TemplatesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const confirmBarRef = useRef<HTMLDivElement>(null)

  // Scroll the confirm bar into view whenever a new confirmation is requested
  useEffect(() => {
    if (pendingAction) {
      confirmBarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [pendingAction])

  const [building, setBuilding] = useState(false)
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set())
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [filterBuilt, setFilterBuilt] = useState<"all" | "built" | "unbuilt">("all")

  // Template list — cached for fast subsequent loads
  const { data: templates = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: async () => {
      const result = await ludusApi.listTemplates()
      return result.data ?? []
    },
    staleTime: STALE.long,
  })

  const fetchLogs = useCallback(async () => {
    const logsResult = await ludusApi.getTemplateLogs()
    if (logsResult.data) {
      const logText = (logsResult.data as { result?: string })?.result || ""
      const parsed = logText.split("\n").filter((l) => l.trim())
      if (parsed.length > 0) setLogLines(parsed)
    }
  }, [])

  // Template build status — polls every 3 s while building, otherwise only checks on mount
  useQuery({
    queryKey: queryKeys.templateStatus(),
    queryFn: async () => {
      const result = await ludusApi.getTemplateStatus()
      return result.data ?? null
    },
    refetchInterval: building ? 3000 : false,
    staleTime: 0,
    select: (data) => {
      const isActive = Array.isArray(data) ? data.length > 0 : data != null
      return isActive
    },
  })

  // Detect and resume an in-progress build on mount / page navigation
  useEffect(() => {
    const checkBuildStatus = async () => {
      const statusResult = await ludusApi.getTemplateStatus()
      const isActive = Array.isArray(statusResult.data)
        ? statusResult.data.length > 0
        : statusResult.data != null && !statusResult.error
      if (isActive) {
        setBuilding(true)
        setShowLogs(true)
        fetchLogs()
      }
    }
    checkBuildStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll logs + check completion while building
  useEffect(() => {
    if (!building) return

    const interval = setInterval(async () => {
      fetchLogs()

      const statusResult = await ludusApi.getTemplateStatus()
      const stillBuilding = Array.isArray(statusResult.data)
        ? statusResult.data.length > 0
        : statusResult.data != null && !statusResult.error
      if (!stillBuilding) {
        setBuilding(false)
        queryClient.invalidateQueries({ queryKey: queryKeys.templates() })
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [building, fetchLogs, queryClient])

  const toggleSelect = (name: string) => {
    setSelectedTemplates((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const doBuild = async (templateNames?: string[]) => {
    const names = templateNames || Array.from(selectedTemplates)
    if (names.length === 0) {
      toast({ variant: "destructive", title: "No templates selected" })
      return
    }
    setLogLines([])
    setShowLogs(true)
    setBuilding(true)
    const result = await ludusApi.buildTemplates(names)
    if (result.error) {
      toast({ variant: "destructive", title: "Build failed", description: result.error })
      setBuilding(false)
    } else {
      toast({ title: "Build started", description: `Building ${names.length} template(s)` })
    }
  }
  const handleBuild = (templateNames?: string[]) => {
    const names = templateNames || Array.from(selectedTemplates)
    if (names.length === 0) { toast({ variant: "destructive", title: "No templates selected" }); return }
    confirm(
      names.length === 1 ? `Build template "${names[0]}"?` : `Build ${names.length} selected templates?`,
      () => doBuild(templateNames)
    )
  }

  const doAbort = async () => {
    await ludusApi.abortTemplateBuild()
    setBuilding(false)
    toast({ title: "Build aborted" })
  }
  const handleAbort = () => confirm("Abort the running template build?", doAbort)

  const doDelete = async (name: string) => {
    const result = await del(`/template/${encodeURIComponent(name)}`)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Template deleted" })
      queryClient.invalidateQueries({ queryKey: queryKeys.templates() })
    }
  }
  const handleDelete = (name: string) =>
    confirm(`Delete template "${name}"? This cannot be undone.`, () => doDelete(name))

  const filtered = templates
    .filter((t) => {
      if (filterBuilt === "built") return t.built
      if (filterBuilt === "unbuilt") return !t.built
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const builtCount = templates.filter((t) => t.built).length
  const installedNames = new Set(templates.map((t) => t.name))

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Templates</p>
            <p className="text-2xl font-bold mt-1">{templates.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Built</p>
            <p className="text-2xl font-bold mt-1 text-green-400">{builtCount}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Not Built</p>
            <p className="text-2xl font-bold mt-1 text-yellow-400">{templates.length - builtCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card ref={confirmBarRef}>
        <CardContent className="p-3 space-y-2">
          <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
          <div className="flex flex-wrap gap-2 items-center">
          <Button
            onClick={() => handleBuild()}
            disabled={building || selectedTemplates.size === 0 || !!pendingAction}
          >
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {building ? "Building..." : `Build Selected (${selectedTemplates.size})`}
          </Button>
          {building && (
            <Button variant="destructive" onClick={handleAbort} disabled={!!pendingAction}>
              <StopCircle className="h-4 w-4" />
              Abort
            </Button>
          )}

          <div className="flex gap-1 ml-2">
            {(["all", "built", "unbuilt"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filterBuilt === f ? "secondary" : "ghost"}
                onClick={() => setFilterBuilt(f)}
                className="capitalize text-xs"
              >
                {f}
              </Button>
            ))}
          </div>

          <div className="flex-1" />

          <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.templates() })} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          </div>
        </CardContent>
      </Card>

      {/* Build Logs */}
      {showLogs && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className={cn("h-4 w-4", building && "animate-pulse text-yellow-400")} />
                Packer Build Logs
                {building && <Badge variant="warning">Building</Badge>}
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowLogs(false)}>Hide</Button>
            </div>
          </CardHeader>
          <CardContent>
            <LogViewer lines={logLines} maxHeight="350px" />
          </CardContent>
        </Card>
      )}

      {/* Add from Source */}
      <AddFromSource installedNames={installedNames} onAdded={() => queryClient.invalidateQueries({ queryKey: queryKeys.templates() })} />

      {/* Template List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookTemplate className="h-4 w-4 text-primary" />
            Templates
            <Badge variant="secondary" className="text-xs">{filtered.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="w-10 p-3 text-left">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedTemplates.size === filtered.length && filtered.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTemplates(new Set(filtered.map((t) => t.name)))
                          } else {
                            setSelectedTemplates(new Set())
                          }
                        }}
                      />
                    </th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Template Name</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">OS</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        <BookTemplate className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p>No templates found</p>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((template) => (
                      <tr
                        key={template.name}
                        className={cn(
                          "border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors",
                          selectedTemplates.has(template.name) && "bg-primary/5"
                        )}
                      >
                        <td className="p-3">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={selectedTemplates.has(template.name)}
                            onChange={() => toggleSelect(template.name)}
                          />
                        </td>
                        <td className="p-3">
                          <span className="font-mono text-xs">{template.name}</span>
                        </td>
                        <td className="p-3">
                          <OsBadge os={template.os} />
                        </td>
                        <td className="p-3">
                          {template.built ? (
                            <div className="flex items-center gap-1.5 text-green-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span className="text-xs">Built</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <XCircle className="h-3.5 w-3.5" />
                              <span className="text-xs">Not Built</span>
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleBuild([template.name])}
                              disabled={building || !!pendingAction}
                            >
                              <Play className="h-3 w-3 text-green-400" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleDelete(template.name)}
                              disabled={!!pendingAction}
                            >
                              <Trash2 className="h-3 w-3 text-red-400" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
