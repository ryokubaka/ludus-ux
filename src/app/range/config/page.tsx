"use client"

import { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { keepPreviousData } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { LogViewer } from "@/components/range/log-viewer"
import { YamlEditor } from "@/components/range/yaml-editor"
import {
  Save,
  Play,
  StopCircle,
  RefreshCw,
  Tag,
  Activity,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import { useRange } from "@/lib/range-context"
import { useToast } from "@/hooks/use-toast"
import { useDeployLogs } from "@/hooks/use-deploy-logs"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { cn } from "@/lib/utils"

const ALL_TAGS = [
  "vm-deploy",
  "network",
  "dns-rewrites",
  "assign-ip",
  "windows",
  "dcs",
  "domain-join",
  "sysprep",
  "user-defined-roles",
  "custom-choco",
  "linux-packages",
  "additional-tools",
  "install-office",
  "install-visual-studio",
  "allow-share-access",
  "custom-groups",
  "share",
  "nexus",
]

const TAG_DESCRIPTIONS: Record<string, string> = {
  "vm-deploy": "Create all VMs defined in config",
  network: "Set up VLANs and firewall rules",
  "dns-rewrites": "Configure DNS rewrites",
  "assign-ip": "Set static IPs and hostnames",
  windows: "Configure Windows VMs (RDP, WinRM, etc.)",
  dcs: "Set up domain controllers",
  "domain-join": "Join Windows VMs to domain",
  sysprep: "Run sysprep on Windows VMs",
  "user-defined-roles": "Apply Ansible roles",
  "custom-choco": "Install chocolatey packages",
  "linux-packages": "Install Linux packages",
  "additional-tools": "Install Firefox, Chrome, Burp, etc.",
  "install-office": "Install Microsoft Office",
  "install-visual-studio": "Install Visual Studio",
  "allow-share-access": "Enable anonymous SMB share access",
  "custom-groups": "Set custom Ansible groups",
  share: "Deploy Ludus Share VM",
  nexus: "Deploy Nexus cache VM",
}

export default function RangeConfigPage() {
  const { toast } = useToast()
  const { selectedRangeId } = useRange()
  const queryClient = useQueryClient()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const [config, setConfig] = useState("")
  const [originalConfig, setOriginalConfig] = useState("")
  const [saving, setSaving] = useState(false)
  // Track which range's config is currently loaded in the editor so background
  // refetches don't silently overwrite what the user has typed or saved.
  const lastSyncedRangeRef = useRef<string | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [limitVM, setLimitVM] = useState("")
  const [showTagSelector, setShowTagSelector] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const { lines, isStreaming, startStreaming, stopStreaming, clearLogs } = useDeployLogs({
    onComplete: () => setDeploying(false),
  })

  const logsRef = useRef<HTMLDivElement>(null)

  // Range config — cached, reloads when selectedRangeId changes.
  // Config rarely changes externally, so use a long stale time to avoid
  // spurious background refetches overwriting the user's unsaved edits.
  const { data: cachedConfig, isLoading: loading } = useQuery({
    queryKey: queryKeys.rangeConfig(selectedRangeId),
    queryFn: async () => {
      const result = await ludusApi.getRangeConfig(selectedRangeId ?? undefined)
      if (result.error) throw new Error(result.error)
      const raw = result.data as { result?: string } | string
      return typeof raw === "string"
        ? raw
        : (raw as { result?: string })?.result || JSON.stringify(raw, null, 2)
    },
    staleTime: STALE.long,
    placeholderData: keepPreviousData,
  })

  // Sync editor ONLY on initial load or when the active range changes.
  // Background refetches must NOT overwrite what the user has typed or already saved —
  // use lastSyncedRangeRef to track which range is currently loaded in the editor.
  useEffect(() => {
    if (!cachedConfig || typeof cachedConfig !== "string") return
    const rangeKey = selectedRangeId ?? "default"
    if (lastSyncedRangeRef.current === rangeKey) return
    setConfig(cachedConfig)
    setOriginalConfig(cachedConfig)
    lastSyncedRangeRef.current = rangeKey
  }, [cachedConfig, selectedRangeId])

  // On mount: check if a deployment is already running so navigating
  // away and back doesn't lose the in-progress status.
  useEffect(() => {
    const checkDeployStatus = async () => {
      const rangeResult = await ludusApi.getRangeStatus()
      if (rangeResult.data?.rangeState === "DEPLOYING") {
        setDeploying(true)
        setShowLogs(true)
        startStreaming()
      }
    }
    checkDeployStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRangeId])

  const handleSave = async () => {
    setSaving(true)
    const result = await ludusApi.setRangeConfig(config, selectedRangeId ?? undefined)
    if (result.error) {
      toast({ variant: "destructive", title: "Save failed", description: result.error })
    } else {
      setOriginalConfig(config)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      toast({ title: "Config saved" })
      // Update the cached config so navigating away and back shows the saved version
      queryClient.setQueryData(queryKeys.rangeConfig(selectedRangeId), config)
    }
    setSaving(false)
  }

  const doDeploy = async () => {
    if (config !== originalConfig) {
      await handleSave()
    }
    clearLogs()
    setShowLogs(true)
    setDeploying(true)
    // Scroll to the logs panel after React renders it
    setTimeout(() => logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
    const result = await ludusApi.deployRange(
      selectedTags.length > 0 ? selectedTags : undefined,
      limitVM || undefined,
      selectedRangeId ?? undefined
    )
    if (result.error) {
      toast({ variant: "destructive", title: "Deploy failed", description: result.error })
      setDeploying(false)
      return
    }
    toast({ title: "Deployment started", description: selectedTags.length > 0 ? `Tags: ${selectedTags.join(", ")}` : "Full deployment" })
    startStreaming()
  }
  const handleDeploy = () =>
    confirm(
      selectedTags.length > 0
        ? `Deploy with tags: ${selectedTags.join(", ")}?`
        : "Start full range deployment?",
      doDeploy
    )

  const doAbort = async () => {
    await ludusApi.abortDeploy(selectedRangeId ?? undefined)
    stopStreaming()
    setDeploying(false)
    toast({ title: "Deploy aborted" })
  }
  const handleAbort = () => confirm("Abort the running deployment?", doAbort)

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const isDirty = config !== originalConfig

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave} disabled={saving || !isDirty} variant={isDirty ? "default" : "outline"}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving..." : "Save Config"}
            </Button>

            {saveSuccess && (
              <span className="flex items-center gap-1 text-sm text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Saved
              </span>
            )}

            {isDirty && (
              <Badge variant="warning" className="text-xs">Unsaved changes</Badge>
            )}

            <div className="flex-1" />

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTagSelector(!showTagSelector)}
              disabled={!!pendingAction}
            >
              <Tag className="h-4 w-4" />
              Tags
              {selectedTags.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{selectedTags.length}</Badge>
              )}
            </Button>

            <Button
              onClick={handleDeploy}
              disabled={deploying || !!pendingAction}
              variant={deploying ? "secondary" : "default"}
            >
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {deploying ? "Deploying..." : "Deploy"}
            </Button>

            {deploying && (
              <Button variant="destructive" onClick={handleAbort} disabled={!!pendingAction}>
                <StopCircle className="h-4 w-4" />
                Abort
              </Button>
            )}

            <Button variant="ghost" size="icon" onClick={() => {
              lastSyncedRangeRef.current = null // allow the incoming data to replace editor content
              queryClient.invalidateQueries({ queryKey: queryKeys.rangeConfig(selectedRangeId) })
            }} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tag Selector */}
      {showTagSelector && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Deploy Tags
              <span className="text-xs text-muted-foreground font-normal">
                (leave empty for full deployment)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {ALL_TAGS.map((tag) => (
                <div
                  key={tag}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                    selectedTags.includes(tag)
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                  onClick={() => toggleTag(tag)}
                >
                  <Checkbox
                    checked={selectedTags.includes(tag)}
                    onCheckedChange={() => toggleTag(tag)}
                    className="mt-0.5"
                  />
                  <div>
                    <code className="text-xs font-mono text-primary">{tag}</code>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {TAG_DESCRIPTIONS[tag] || ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {selectedTags.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelectedTags([])}>
                Clear all tags
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info banner */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Add{" "}
          <code className="text-primary text-xs">
            # yaml-language-server: $schema=https://docs.ludus.cloud/schemas/range-config.json
          </code>{" "}
          to the top of your config for schema validation hints.
        </AlertDescription>
      </Alert>

      {/* YAML Editor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">range-config.yml</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <YamlEditor
              value={config}
              onChange={setConfig}
              height="600px"
            />
          )}
        </CardContent>
      </Card>

      {/* Deploy Logs */}
      {showLogs && (
        <Card ref={logsRef}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className={cn("h-4 w-4", isStreaming && "animate-pulse text-green-400")} />
                Deploy Logs
                {isStreaming && <Badge variant="success">Live</Badge>}
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowLogs(false)}>Hide</Button>
            </div>
          </CardHeader>
          <CardContent>
            <LogViewer lines={lines} onClear={clearLogs} maxHeight="400px" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
