"use client"

import { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { STALE } from "@/lib/query-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { LogViewerCompound } from "@/components/range/log-viewer"
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
  ChevronDown,
  ChevronRight,
  Shield,
  Filter,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import { LUDUS_DEPLOY_TAGS, LUDUS_DEPLOY_TAG_DESCRIPTIONS } from "@/lib/ludus-deploy-tags"
import { resolveDeployLimitPattern } from "@/lib/ludus-deploy-limit"
import { DeployLimitSelector } from "@/components/range/deploy-limit-selector"
import { registerLuxDeployTagRun } from "@/lib/register-lux-deploy-tag-run"
import { useRange } from "@/lib/range-context"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"
import { useToast } from "@/hooks/use-toast"
import { useDeployLogs } from "@/hooks/use-deploy-logs"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { cn } from "@/lib/utils"
import { NetworkRulesEditor } from "@/components/range/network-rules-editor"
import { type NetworkRule, extractNetworkRules, injectNetworkRules, extractVlansFromConfig } from "@/lib/network-rules"

const ALL_TAGS = [...LUDUS_DEPLOY_TAGS]
const TAG_DESCRIPTIONS = LUDUS_DEPLOY_TAG_DESCRIPTIONS

function buildDeployConfirmMessage(
  tags: string[],
  limitPattern: string | undefined,
): string {
  const parts: string[] = []
  if (tags.length > 0) parts.push(`tags: ${tags.join(", ")}`)
  if (limitPattern) parts.push(`limit: ${limitPattern}`)
  if (parts.length === 0) return "Start full range deployment?"
  return `Deploy with ${parts.join(", ")}?`
}

function buildDeployToastDescription(
  tags: string[] | undefined,
  limitPattern: string | undefined,
): string {
  const parts: string[] = []
  if (tags?.length) parts.push(`Tags: ${tags.join(", ")}`)
  else parts.push("Full tag set")
  if (limitPattern) parts.push(`Limit: ${limitPattern}`)
  return parts.join(" · ")
}

export function RangeConfigPageClient() {
  const { toast } = useToast()
  const { selectedRangeId, ranges, loading: rangesLoading } = useRange()
  const scopeTag = useEffectiveScopeTag()
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
  const [selectedLimitHosts, setSelectedLimitHosts] = useState<string[]>([])
  const [customLimitPattern, setCustomLimitPattern] = useState("")
  const [showTagSelector, setShowTagSelector] = useState(false)
  const [showLimitSelector, setShowLimitSelector] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [networkRules, setNetworkRules] = useState<NetworkRule[]>([])
  const [showNetworkRules, setShowNetworkRules] = useState(false)
  /** Ludus blocks config PUT and range deploy in testing mode unless force is set (CLI `--force`). */
  const [forceLudus, setForceLudus] = useState(false)

  const { lines, isStreaming, startStreaming, stopStreaming, clearLogs } = useDeployLogs({
    onComplete: () => setDeploying(false),
  })

  const logsRef = useRef<HTMLDivElement>(null)

  // Range config — cached, reloads when selectedRangeId changes.
  // Config rarely changes externally, so use a long stale time to avoid
  // spurious background refetches overwriting the user's unsaved edits.
  //
  // Gate on `selectedRangeId`: without it the proxy hits Ludus `/range/config`
  // (no rangeID query), which falls back to the caller's default range and
  // returns 404 if the default range has been deleted (common after GOAD
  // range reassignment). That 404 is both noisy in devtools and misleading
  // since the user actually has other ranges — the selector just hasn't
  // hydrated yet. Empty-state UI below handles `ranges.length === 0`.
  const { data: cachedConfig, isLoading: loading, isFetching } = useQuery({
    queryKey: queryKeys.rangeConfig(scopeTag, selectedRangeId),
    queryFn: async () => {
      const result = await ludusApi.getRangeConfig(selectedRangeId ?? undefined)
      if (result.error) throw new Error(result.error)
      const raw = result.data as { result?: string } | string
      return typeof raw === "string"
        ? raw
        : (raw as { result?: string })?.result || JSON.stringify(raw, null, 2)
    },
    enabled: !!selectedRangeId,
    staleTime: STALE.long,
  })

  // Clear editor + deploy UI when switching ranges so keepPreviousData-style stale
  // YAML from the prior range cannot briefly appear under the new range key.
  useEffect(() => {
    lastSyncedRangeRef.current = null
    setConfig("")
    setOriginalConfig("")
    setNetworkRules([])
    setSelectedLimitHosts([])
    setCustomLimitPattern("")
    setShowLimitSelector(false)
    stopStreaming()
    setDeploying(false)
    setShowLogs(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRangeId])

  const deployLimitPattern = resolveDeployLimitPattern(selectedLimitHosts, customLimitPattern)
  const limitSelectionCount = customLimitPattern.trim()
    ? 1
    : selectedLimitHosts.length

  // Sync editor ONLY on initial load or when the active range changes.
  // Background refetches must NOT overwrite what the user has typed or already saved —
  // use lastSyncedRangeRef to track which range is currently loaded in the editor.
  useEffect(() => {
    if (!selectedRangeId || !cachedConfig || typeof cachedConfig !== "string") return
    if (lastSyncedRangeRef.current === selectedRangeId) return
    setConfig(cachedConfig)
    setOriginalConfig(cachedConfig)
    setNetworkRules(extractNetworkRules(cachedConfig))
    lastSyncedRangeRef.current = selectedRangeId
  }, [cachedConfig, selectedRangeId])

  // On mount: check if a deployment is already running so navigating
  // away and back doesn't lose the in-progress status. Skip entirely when
  // no range is selected yet — same 404 rationale as the rangeConfig query
  // above.
  useEffect(() => {
    if (!selectedRangeId) return
    const checkDeployStatus = async () => {
      const rangeResult = await ludusApi.getRangeStatus(selectedRangeId)
      if (rangeResult.data?.rangeState === "DEPLOYING") {
        setDeploying(true)
        setShowLogs(true)
        startStreaming(selectedRangeId)
      }
    }
    checkDeployStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRangeId])

  const persistRangeConfig = async (yaml: string): Promise<boolean> => {
    setSaving(true)
    try {
      const result = await ludusApi.setRangeConfig(yaml, selectedRangeId ?? undefined, forceLudus)
      if (result.error) {
        toast({ variant: "destructive", title: "Save failed", description: result.error })
        return false
      }
      setConfig(yaml)
      setOriginalConfig(yaml)
      setNetworkRules(extractNetworkRules(yaml))
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      const msg = result.data?.result ?? ""
      if (/warning/i.test(msg)) {
        toast({ variant: "destructive", title: "Config saved with warning", description: msg })
      } else {
        toast({ title: "Config saved" })
      }
      queryClient.setQueryData(queryKeys.rangeConfig(scopeTag, selectedRangeId), yaml)
      return true
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => persistRangeConfig(config)

  const executeDeploy = async (
    tagsForLudus: string[] | undefined,
    options?: { skipDirtySave?: boolean },
  ) => {
    if (!options?.skipDirtySave && config !== originalConfig) {
      const saved = await persistRangeConfig(config)
      if (!saved) return
    }
    clearLogs()
    setShowLogs(true)
    setDeploying(true)
    // Scroll to the logs panel after React renders it
    setTimeout(() => logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
    const tagRunAt = Date.now()
    const tagList = tagsForLudus && tagsForLudus.length > 0 ? tagsForLudus : undefined
    const result = await ludusApi.deployRange(
      tagList,
      deployLimitPattern,
      selectedRangeId ?? undefined,
      forceLudus,
    )
    if (!result.error && selectedRangeId && tagList && tagList.length > 0) {
      void registerLuxDeployTagRun(selectedRangeId, tagList, tagRunAt)
    }
    if (result.error) {
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: result.error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => {
            setDeploying(false)
            void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
          },
        })
      ) {
        return
      }
      toast({ variant: "destructive", title: "Deploy failed", description: result.error })
      setDeploying(false)
      return
    }
    toast({
      title: "Deployment started",
      description: buildDeployToastDescription(tagList, deployLimitPattern),
    })
    startStreaming(selectedRangeId ?? undefined)
  }

  const doDeploy = async () => {
    await executeDeploy(selectedTags.length > 0 ? selectedTags : undefined)
  }
  const handleDeploy = () =>
    confirm(buildDeployConfirmMessage(selectedTags, deployLimitPattern), doDeploy)

  const doDeployFirewallRules = async () => {
    const merged = injectNetworkRules(config, networkRules)
    const saved = await persistRangeConfig(merged)
    if (!saved) return
    await executeDeploy(["network"], { skipDirtySave: true })
  }

  const confirmDeployFirewallRules = () =>
    confirm(
      "Merge firewall rules into the YAML, save to Ludus, then deploy with the **network** tag only?",
      doDeployFirewallRules,
    )

  const firewallRulesForceId = "force-range-ludus-testing-firewall"

  const doAbort = async () => {
    const result = await ludusApi.abortDeploy(selectedRangeId ?? undefined)
    if (result.error) {
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: result.error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => {
            stopStreaming()
            setDeploying(false)
            void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
          },
        })
      ) {
        return
      }
      toast({ variant: "destructive", title: "Abort request failed", description: result.error })
      return
    }
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

  // No range available yet (either still hydrating or the user actually has
  // zero ranges). Bail out before rendering the editor rather than firing
  // `/range/config` against no rangeID (→ 404 on the default range lookup).
  if (!selectedRangeId) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center gap-3 text-center">
            {rangesLoading ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading ranges…</p>
              </>
            ) : ranges.length === 0 ? (
              <>
                <AlertTriangle className="h-6 w-6 text-status-warning" />
                <div>
                  <p className="text-sm font-medium text-foreground">No ranges available</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Deploy a new range first, or ask an admin to share one with you.
                  </p>
                </div>
              </>
            ) : (
              <>
                <Info className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Select a range from the sidebar to edit its configuration.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Deploy Logs — shown at the top so it's immediately visible when a deploy starts */}
      {showLogs && (
        <Card ref={logsRef}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className={cn("h-4 w-4", isStreaming && "animate-pulse text-status-success")} />
                Deploy Logs
                {isStreaming && <Badge variant="success">Live</Badge>}
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowLogs(false)}>Hide</Button>
            </div>
          </CardHeader>
          <CardContent>
            <LogViewerCompound.Root lines={lines} onClear={clearLogs} maxHeight="400px">
              <LogViewerCompound.Toolbar />
              <LogViewerCompound.Search />
              <LogViewerCompound.Body />
            </LogViewerCompound.Root>
          </CardContent>
        </Card>
      )}

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
              <span className="flex items-center gap-1 text-sm text-status-success">
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
              variant="outline"
              size="sm"
              onClick={() => setShowLimitSelector(!showLimitSelector)}
              disabled={!!pendingAction}
            >
              <Filter className="h-4 w-4" />
              Limit
              {limitSelectionCount > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{limitSelectionCount}</Badge>
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
              queryClient.invalidateQueries({ queryKey: queryKeys.rangeConfig(scopeTag, selectedRangeId) })
            }} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
            <Checkbox
              id="force-range-ludus-testing"
              checked={forceLudus}
              onCheckedChange={(v) => setForceLudus(v === true)}
              disabled={!!pendingAction || saving}
            />
            <Label
              htmlFor="force-range-ludus-testing"
              className="text-xs text-muted-foreground font-normal cursor-pointer leading-snug max-w-2xl"
            >
              Force save & deploy (same as Ludus CLI{" "}
              <code className="text-[11px] text-primary/90">--force</code>) — Ludus blocks saving config and starting
              deployment while the range is in testing mode unless this is checked. Does not turn testing mode off.
            </Label>
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
                <label
                  key={tag}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                    selectedTags.includes(tag)
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
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
                </label>
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

      {showLimitSelector && selectedRangeId && (
        <DeployLimitSelector
          rangeId={selectedRangeId}
          configYaml={config}
          selectedHosts={selectedLimitHosts}
          onSelectedHostsChange={setSelectedLimitHosts}
          customPattern={customLimitPattern}
          onCustomPatternChange={setCustomLimitPattern}
          disabled={!!pendingAction || deploying}
        />
      )}

      {/* Network Rules panel */}
      <Card>
        <CardHeader
          className="px-4 py-3 cursor-pointer select-none"
          onClick={() => setShowNetworkRules((v) => !v)}
        >
          <CardTitle className="text-sm flex items-center gap-2 leading-none">
            {showNetworkRules ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Shield className="h-4 w-4" />
            Firewall Rules
            {networkRules.length > 0 && (
              <Badge variant="secondary" className="text-xs ml-1">
                {networkRules.length}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground font-normal ml-1">
              (visual editor — click to expand)
            </span>
          </CardTitle>
        </CardHeader>
        {showNetworkRules && (
          <CardContent className="pt-0">
            <NetworkRulesEditor
              rules={networkRules}
              onChange={setNetworkRules}
              availableVlans={extractVlansFromConfig(cachedConfig ?? "")}
              showApplyButton
              onApply={() => {
                const updated = injectNetworkRules(config, networkRules)
                setConfig(updated)
                toast({ title: "Firewall rules applied", description: "Review the YAML below, then save." })
              }}
              actionSlot={
                <>
                  <Button
                    type="button"
                    variant={isDirty ? "default" : "outline"}
                    size="sm"
                    onClick={() => void persistRangeConfig(config)}
                    disabled={saving || !isDirty || !!pendingAction}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? "Saving…" : "Save Config"}
                  </Button>
                  <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1">
                    <Checkbox
                      id={firewallRulesForceId}
                      checked={forceLudus}
                      onCheckedChange={(v) => setForceLudus(v === true)}
                      disabled={!!pendingAction || saving}
                    />
                    <Label
                      htmlFor={firewallRulesForceId}
                      className="text-xs text-muted-foreground font-normal cursor-pointer leading-snug"
                      title="Same as toolbar: allow save/deploy while Ludus range is in testing mode (--force)"
                    >
                      Force
                    </Label>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => confirmDeployFirewallRules()}
                    disabled={deploying || !!pendingAction || saving}
                  >
                    <Play className="h-4 w-4" />
                    Deploy Firewall Rules
                  </Button>
                </>
              }
            />
          </CardContent>
        )}
      </Card>

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

    </div>
  )
}
