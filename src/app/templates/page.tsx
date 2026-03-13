"use client"

import { useState, useEffect, useCallback } from "react"
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
} from "lucide-react"
import { ludusApi, del } from "@/lib/api"
import type { TemplateObject } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"

export default function TemplatesPage() {
  const { toast } = useToast()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const [templates, setTemplates] = useState<TemplateObject[]>([])
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set())
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [filterBuilt, setFilterBuilt] = useState<"all" | "built" | "unbuilt">("all")

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    const result = await ludusApi.listTemplates()
    if (result.data) setTemplates(result.data)
    setLoading(false)
  }, [])

  const fetchLogs = useCallback(async () => {
    const logsResult = await ludusApi.getTemplateLogs()
    if (logsResult.data) {
      const logText = (logsResult.data as { result?: string })?.result || ""
      const parsed = logText.split("\n").filter((l) => l.trim())
      if (parsed.length > 0) setLogLines(parsed)
    }
  }, [])

  // On mount: check if a template build is already running so navigating
  // away and back doesn't lose the in-progress status.
  useEffect(() => {
    fetchTemplates()

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
  }, [fetchTemplates, fetchLogs])

  // Poll logs + build status while building
  useEffect(() => {
    if (!building) return

    const interval = setInterval(async () => {
      fetchLogs()

      // getTemplateStatus returns null/error when Packer has finished
      const statusResult = await ludusApi.getTemplateStatus()
      const stillBuilding = Array.isArray(statusResult.data)
        ? statusResult.data.length > 0
        : statusResult.data != null && !statusResult.error
      if (!stillBuilding) {
        setBuilding(false)
        fetchTemplates()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [building, fetchTemplates, fetchLogs])

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
      fetchTemplates()
    }
  }
  const handleDelete = (name: string) =>
    confirm(`Delete template "${name}"? This cannot be undone.`, () => doDelete(name))

  const filtered = templates.filter((t) => {
    if (filterBuilt === "built") return t.built
    if (filterBuilt === "unbuilt") return !t.built
    return true
  })

  const builtCount = templates.filter((t) => t.built).length

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
      <Card>
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

          <Button variant="ghost" size="icon" onClick={fetchTemplates} disabled={loading}>
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
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">
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
