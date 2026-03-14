"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { GoadTerminal, useGoadStream } from "@/components/goad/goad-terminal"
import {
  Terminal,
  ChevronRight,
  ChevronLeft,
  Play,
  Puzzle,
  Check,
  Loader2,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Info,
  StopCircle,
  Server,
  PackageCheck,
  PackageX,
  CircleAlert,
} from "lucide-react"
import Link from "next/link"
import type { GoadLabDef, GoadExtensionDef, GoadCatalog, TemplateObject } from "@/lib/types"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { getImpersonationHeaders } from "@/lib/api"
import { useDeployLogs } from "@/hooks/use-deploy-logs"
import { useRange } from "@/lib/range-context"

// ── Template readiness helpers ────────────────────────────────────────────────

/** Returns { present, missing } template lists for a given set of required names */
function checkTemplates(required: string[], builtNames: Set<string>, allNames: Set<string>) {
  const present: string[] = []
  const missingUnbuilt: string[] = [] // installed but not yet built
  const missingAbsent: string[] = []  // not installed at all
  for (const t of required) {
    if (builtNames.has(t)) present.push(t)
    else if (allNames.has(t)) missingUnbuilt.push(t)
    else missingAbsent.push(t)
  }
  return { present, missingUnbuilt, missingAbsent, ready: missingUnbuilt.length === 0 && missingAbsent.length === 0 }
}

/** Inline template chip list for a lab card or extension row */
function TemplateChips({
  required,
  builtNames,
  allNames,
}: {
  required: string[]
  builtNames: Set<string>
  allNames: Set<string>
}) {
  if (required.length === 0) return null
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {required.map((t) => {
          const built = builtNames.has(t)
          const installed = allNames.has(t)

          const chip = (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border",
                built
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : installed
                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              )}
            >
              {built
                ? <Check className="h-2.5 w-2.5 flex-shrink-0" />
                : installed
                ? <CircleAlert className="h-2.5 w-2.5 flex-shrink-0" />
                : <PackageX className="h-2.5 w-2.5 flex-shrink-0" />}
              {t}
            </span>
          )

          if (built) {
            return (
              <Tooltip key={t}>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="border-green-500/30 bg-green-950/90 text-green-300 text-xs px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-green-400 flex-shrink-0" />
                    <span><span className="font-mono font-semibold">{t}</span> — installed &amp; built</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          }

          return (
            <span
              key={t}
              title={installed ? "Installed but not yet built — go to Templates to build" : "Not installed — go to Templates to add"}
            >
              {chip}
            </span>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

const STEPS = ["Select Lab Type", "Select Extensions", "Select Range", "Review & Deploy"]

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export default function NewGoadInstancePage() {
  const router = useRouter()
  const { ranges: accessibleRanges, selectRange, refreshRanges } = useRange()
  const [step, setStep] = useState(0)
  const [selectedLab, setSelectedLab] = useState<string | null>(null)
  const [selectedExtensions, setSelectedExtensions] = useState<Set<string>>(new Set())
  const [deployed, setDeployed] = useState(false)
  const [creatingRange, setCreatingRange] = useState(false)
  const [dedicatedRangeId, setDedicatedRangeId] = useState<string | null>(null)
  const [currentUsername, setCurrentUsername] = useState<string>("")

  // Range selection (step 2)
  const [rangeMode, setRangeMode] = useState<"new" | "existing">("new")
  const [selectedExistingRange, setSelectedExistingRange] = useState<string>("")
  // Stable UID for the auto-generated range name preview — generated once on mount
  const [newRangeUid] = useState(() => Date.now().toString(36).toUpperCase().slice(-4))

  // Template readiness
  const [templates, setTemplates] = useState<TemplateObject[]>([])
  const builtNames = new Set(templates.filter((t) => t.built).map((t) => t.name))
  const allNames   = new Set(templates.map((t) => t.name))

  // Fetch session username for range naming convention + installed templates
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => { if (d.username) setCurrentUsername(d.username) })
      .catch(() => {})

    fetch("/api/proxy/templates")
      .then((r) => r.ok ? r.json() : [])
      .then((d) => {
        const list: TemplateObject[] = Array.isArray(d) ? d : (d?.result ?? [])
        setTemplates(list)
      })
      .catch(() => {})
  }, [])
  const { lines, isRunning, exitCode, run, stop, clear } = useGoadStream("goad-task-new")
  const {
    lines: rangeLogLines,
    isStreaming: isRangeStreaming,
    rangeState,
    startStreaming: startRangeStreaming,
    stopStreaming: stopRangeStreaming,
    clearLogs: clearRangeLogs,
  } = useDeployLogs()

  // Catalog state
  const [catalog, setCatalog] = useState<GoadCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const fetchCatalog = async (refresh = false) => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const res = await fetch("/api/goad/catalog", {
        method: refresh ? "POST" : "GET",
      })
      const data: GoadCatalog & { error?: string; message?: string } = await res.json()
      if (data.error) {
        setCatalogError(data.error)
      } else if (!data.configured) {
        setCatalogError(data.message || "GOAD SSH not configured")
      } else {
        setCatalog(data)
      }
    } catch (err) {
      setCatalogError((err as Error).message)
    }
    setCatalogLoading(false)
  }

  useEffect(() => { fetchCatalog() }, [])

  const toggleExtension = (name: string) => {
    setSelectedExtensions((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Extensions compatible with the selected lab
  const compatExtensions: GoadExtensionDef[] = (catalog?.extensions ?? []).filter((ext) => {
    if (!selectedLab) return true
    return ext.compatibility.includes("*") || ext.compatibility.includes(selectedLab)
  })

  // Preview of the auto-generated range ID for the "Create New Range" option
  const autoRangeId = useMemo(() => {
    const user    = (currentUsername || "user").toLowerCase().replace(/[^a-z0-9]/g, "")
    const labSlug = (selectedLab ?? "lab").replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")
    return `${user}-${labSlug}-${newRangeUid}`
  }, [currentUsername, selectedLab, newRangeUid])

  /**
   * Always creates a fresh dedicated Ludus range for this GOAD deployment.
   *
   * We intentionally never reuse an existing range — even an empty one.
   * The "reuse empty range" optimisation was removed because GET /range only
   * returns the user's *default* range, so an empty `melchior` would be
   * mistakenly picked, setting LUDUS_RANGE_ID=melchior and causing GOAD's
   * internal `ludus range rm` to destroy the user's primary range.
   *
   * Returns { rangeId, created } or null if range creation fails.
   */
  const resolveDeployRange = async (): Promise<{ rangeId: string; created: boolean } | null> => {
    // Always create a new dedicated range.
    // Naming convention: <user>-<labname>-<uid>  e.g. "melchior-GOAD-Mini-LDQ8"
    // Uses the stable newRangeUid so the preview shown in step 2 matches the actual ID.
    const candidateId = autoRangeId
    const displayName = candidateId

    try {
      // Include impersonation headers so the route assigns the range to the
      // correct user (admin impersonation is forwarded transparently).
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...getImpersonationHeaders(),
      }

      const res = await fetch("/api/range/create", {
        method: "POST",
        headers,
        body: JSON.stringify({
          rangeID: candidateId,
          name: displayName,
          description: `Dedicated Ludus range for GOAD ${selectedLab} instance`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok || res.status === 409) {
        return { rangeId: candidateId, created: true }
      }
      console.warn("Range creation failed:", data.error)
    } catch (err) {
      console.warn("Range creation error:", err)
    }
    return null
  }

  const handleDeploy = async () => {
    if (!selectedLab) return

    // Snapshot existing instance IDs so we can diff after deploy to find the new one
    let instanceIdsBefore: Set<string> = new Set()
    try {
      const snap = await fetch("/api/goad/instances", { headers: getImpersonationHeaders() })
      if (snap.ok) {
        const snapData = await snap.json()
        instanceIdsBefore = new Set(
          (snapData.instances ?? []).map((i: { instanceId: string }) => i.instanceId)
        )
      }
    } catch { /* best-effort */ }

    let rangeId: string | null = null
    if (rangeMode === "existing" && selectedExistingRange) {
      // User chose an existing range — use it directly, no creation needed
      rangeId = selectedExistingRange
      setDedicatedRangeId(rangeId)
      selectRange(rangeId)
    } else {
      // Create a new dedicated range for this GOAD instance
      setCreatingRange(true)
      try {
        const result = await resolveDeployRange()
        if (result) {
          rangeId = result.rangeId
          setDedicatedRangeId(rangeId)
          await refreshRanges()
          selectRange(rangeId)
        }
        // If null, proceed without a rangeId — GOAD will use its default range
      } finally {
        setCreatingRange(false)
      }
    }

    const exts = Array.from(selectedExtensions)
    const extArgs = exts.map((e) => `-e ${shellQuote(e)}`).join(" ")
    const args = `-l ${shellQuote(selectedLab)} -p ludus -m local -t install${extArgs ? ` ${extArgs}` : ""}`
    setDeployed(true)
    // Poll range logs scoped to the target range (not the sidebar selection)
    startRangeStreaming(rangeId ?? undefined)
    await run(args, undefined, undefined, rangeId ?? undefined)

    // After deploy completes, link any newly created instance to the dedicated range
    if (rangeId) {
      try {
        const after = await fetch("/api/goad/instances", { headers: getImpersonationHeaders() })
        if (after.ok) {
          const afterData = await after.json()
          const newIds: string[] = (afterData.instances ?? [])
            .filter((i: { instanceId: string; ludusRangeId?: string }) =>
              !instanceIdsBefore.has(i.instanceId) || !i.ludusRangeId
            )
            .map((i: { instanceId: string }) => i.instanceId)
          if (newIds.length > 0) {
            await fetch("/api/goad/instances/set-range", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
              body: JSON.stringify({ rangeId, instanceIds: newIds }),
            })
          }
        }
      } catch { /* best-effort — user can manually init-range if needed */ }
    }
  }

  const handleStop = async () => {
    await stop()
    stopRangeStreaming()
    // Also abort the Ludus range deployment so VMs stop being created
    if (dedicatedRangeId) {
      try {
        await fetch(
          `/api/proxy/range/abort?rangeID=${encodeURIComponent(dedicatedRangeId)}`,
          { method: "POST" }
        )
      } catch {
        // Best-effort; user can abort manually from the Dashboard if this fails
      }
    }
  }

  const labInfo: GoadLabDef | undefined = catalog?.labs.find((l) => l.name === selectedLab)

  const showTerminal = step === 3 && (deployed || isRunning)

  return (
    <div className={cn(
      showTerminal
        ? "flex flex-col h-[calc(100vh-7rem)] gap-3 min-h-0 w-full"
        : "max-w-3xl space-y-6"
    )}>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href="/goad">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Deploy New GOAD Instance</h1>
          <p className="text-xs text-muted-foreground">Install a Game of Active Directory instance on your Ludus server</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold",
                i < step
                  ? "bg-green-500/20 text-green-400 border border-green-500/40"
                  : i === step
                  ? "bg-primary/20 text-primary border border-primary/40"
                  : "bg-muted text-muted-foreground border border-border"
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={cn("text-sm", i === step ? "text-foreground font-medium" : "text-muted-foreground")}>
              {s}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Catalog error / not configured */}
      {catalogError && (
        <Alert variant={catalogError.includes("not configured") ? "default" : "destructive"}>
          <Info className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span className="text-sm">{catalogError}</span>
            <Button size="sm" variant="ghost" onClick={() => fetchCatalog(true)} disabled={catalogLoading}>
              <RefreshCw className={cn("h-3 w-3", catalogLoading && "animate-spin")} />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Step 0: Select Lab */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Choose the lab type to deploy:</p>
            <Button variant="ghost" size="sm" onClick={() => fetchCatalog(true)} disabled={catalogLoading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", catalogLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {catalogLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 w-full rounded-lg bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : !catalogError && catalog ? (
            <div className="grid gap-2">
              {catalog.labs.map((lab) => {
                const ludusOk  = lab.ludusSupported !== false  // treat missing field as true (older catalog)
                const tpl      = checkTemplates(lab.requiredTemplates ?? [], builtNames, allNames)
                const tplOk    = tpl.ready || (lab.requiredTemplates ?? []).length === 0
                const canSelect = ludusOk && tplOk
                const isSelected = selectedLab === lab.name
                return (
                  <button
                    key={lab.name}
                    disabled={!canSelect}
                    className={cn(
                      "text-left p-4 rounded-lg border-2 transition-all",
                      !canSelect && "opacity-50 cursor-not-allowed",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : canSelect
                        ? "border-border hover:border-primary/50"
                        : "border-border"
                    )}
                    onClick={() => {
                      if (!canSelect) return
                      setSelectedLab(lab.name)
                      setSelectedExtensions(new Set())
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono font-bold text-primary">{lab.name}</code>
                          <Badge variant="secondary" className="text-xs">{lab.vmCount} VMs</Badge>
                          {lab.domains > 0 && (
                            <Badge variant="secondary" className="text-xs">{lab.domains} domain{lab.domains !== 1 ? "s" : ""}</Badge>
                          )}
                          {/* Incompatible takes priority over missing-templates */}
                          {!ludusOk && (
                            <Badge variant="secondary" className="text-xs gap-1 text-muted-foreground">
                              No Ludus provider
                            </Badge>
                          )}
                          {ludusOk && !tplOk && (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <PackageX className="h-2.5 w-2.5" /> Missing templates
                            </Badge>
                          )}
                          {canSelect && (lab.requiredTemplates ?? []).length > 0 && (
                            <Badge variant="success" className="text-xs gap-1">
                              <PackageCheck className="h-2.5 w-2.5" /> Ready
                            </Badge>
                          )}
                        </div>
                        {lab.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{lab.description}</p>
                        )}
                        {!ludusOk ? (
                          <p className="text-[10px] text-muted-foreground/50 mt-1.5 italic">
                            No <code>providers/ludus/</code> directory — this lab cannot be deployed with Ludus
                          </p>
                        ) : (lab.requiredTemplates ?? []).length > 0
                          ? <TemplateChips required={lab.requiredTemplates} builtNames={builtNames} allNames={allNames} />
                          : <p className="text-[10px] text-muted-foreground/50 mt-1.5 italic">No template requirements detected — hit Refresh if this seems wrong</p>
                        }
                      </div>
                      {isSelected && (
                        <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </div>
                  </button>
                )
              })}

              {catalog.labs.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No labs found in <code className="text-primary">{catalog.goadPath}/ad/</code>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!selectedLab || catalogLoading}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

        </div>
      )}

      {/* Step 1: Extensions */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Select optional extensions for <code className="text-primary font-mono">{selectedLab}</code>:
            </p>
            <Badge variant="secondary">{selectedExtensions.size} selected</Badge>
          </div>

          {compatExtensions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No extensions available for this lab
            </div>
          ) : (
            <div className="grid gap-2">
              {compatExtensions.map((ext) => {
                const tpl = checkTemplates(ext.requiredTemplates ?? [], builtNames, allNames)
                const canEnable = tpl.ready || (ext.requiredTemplates ?? []).length === 0
                const isSelected = selectedExtensions.has(ext.name)
                return (
                  <div
                    key={ext.name}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border transition-all",
                      !canEnable && "opacity-50 cursor-not-allowed",
                      isSelected && canEnable
                        ? "border-primary bg-primary/5"
                        : canEnable
                        ? "border-border hover:border-primary/30 cursor-pointer"
                        : "border-border"
                    )}
                    onClick={() => canEnable && toggleExtension(ext.name)}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={!canEnable}
                      onCheckedChange={() => canEnable && toggleExtension(ext.name)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Puzzle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <code className="font-mono text-xs font-medium text-primary">{ext.name}</code>
                        {ext.machines.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            +{ext.machines.length} VM{ext.machines.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        {!canEnable && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <PackageX className="h-2.5 w-2.5" /> Missing templates
                          </Badge>
                        )}
                      </div>
                      {ext.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{ext.description}</p>
                      )}
                      {ext.impact && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{ext.impact}</p>
                      )}
                      {(ext.requiredTemplates ?? []).length > 0 && (
                        <TemplateChips required={ext.requiredTemplates} builtNames={builtNames} allNames={allNames} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(2)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Select Range */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Target Range</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button variant={rangeMode === "new" ? "default" : "outline"} size="sm"
                  onClick={() => setRangeMode("new")}>
                  Create New Range
                </Button>
                <Button variant={rangeMode === "existing" ? "default" : "outline"} size="sm"
                  onClick={() => setRangeMode("existing")}>
                  Use Existing Range
                </Button>
              </div>

              <Separator />

              {rangeMode === "new" ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    A new dedicated Ludus range will be created for this GOAD instance:
                  </p>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <code className="text-sm font-mono text-primary">{autoRangeId}</code>
                    <Badge variant="secondary" className="ml-auto text-[10px]">new</Badge>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Deploy this GOAD instance into an existing range:
                  </p>
                  {accessibleRanges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No accessible ranges found. Create a new one instead.</p>
                  ) : (
                    <div className="grid gap-2">
                      {accessibleRanges.map((r) => (
                        <button key={r.rangeID} onClick={() => setSelectedExistingRange(r.rangeID)}
                          className={cn(
                            "text-left p-3 rounded-lg border-2 transition-all",
                            selectedExistingRange === r.rangeID
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          )}>
                          <div className="flex items-center justify-between">
                            <code className="font-mono font-bold text-primary text-sm">{r.rangeID}</code>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-[10px]">{r.accessType}</Badge>
                              {selectedExistingRange === r.rangeID && <Check className="h-4 w-4 text-primary" />}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={rangeMode === "existing" && !selectedExistingRange}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Deploy */}
      {step === 3 && !showTerminal && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Deployment Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">Lab</span>
                <code className="font-mono text-sm font-bold text-primary">{selectedLab}</code>
                {labInfo && <Badge variant="secondary">{labInfo.vmCount} VMs</Badge>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">Range</span>
                <code className="font-mono text-sm text-primary">
                  {rangeMode === "existing" ? selectedExistingRange : autoRangeId}
                </code>
                <Badge variant="secondary" className="text-[10px]">
                  {rangeMode === "existing" ? "existing" : "new"}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">Provider</span>
                <span className="text-sm">Ludus</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-xs text-muted-foreground w-24 mt-0.5">Extensions</span>
                <div className="flex flex-wrap gap-1">
                  {selectedExtensions.size === 0 ? (
                    <span className="text-xs text-muted-foreground">None</span>
                  ) : (
                    Array.from(selectedExtensions).map((ext) => (
                      <Badge key={ext} variant="secondary" className="text-xs">{ext}</Badge>
                    ))
                  )}
                </div>
              </div>
              {labInfo?.description && (
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground w-24 mt-0.5">Description</span>
                  <span className="text-xs text-muted-foreground">{labInfo.description}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">GOAD Path</span>
                <code className="text-xs text-muted-foreground font-mono">{catalog?.goadPath}</code>
              </div>
            </CardContent>
          </Card>

          {/* Template readiness summary */}
          {(() => {
            const allRequired = [
              ...(labInfo?.requiredTemplates ?? []),
              ...Array.from(selectedExtensions).flatMap(
                (en) => catalog?.extensions.find((e) => e.name === en)?.requiredTemplates ?? []
              ),
            ]
            const unique = [...new Set(allRequired)]
            if (unique.length === 0) return null
            const summary = checkTemplates(unique, builtNames, allNames)
            return (
              <Card className={cn(
                "border",
                summary.ready ? "border-green-500/30" : "border-red-500/30"
              )}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {summary.ready
                      ? <PackageCheck className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                      : <PackageX className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />}
                    <span className={cn("text-xs font-medium", summary.ready ? "text-green-400" : "text-red-400")}>
                      {summary.ready
                        ? "All required templates are built and ready"
                        : `${summary.missingAbsent.length + summary.missingUnbuilt.length} template${summary.missingAbsent.length + summary.missingUnbuilt.length !== 1 ? "s" : ""} not ready`}
                    </span>
                    <Link href="/templates" className="ml-auto text-[10px] text-primary/70 hover:text-primary underline underline-offset-2">
                      Manage Templates →
                    </Link>
                  </div>
                  <TemplateChips required={unique} builtNames={builtNames} allNames={allNames} />
                </CardContent>
              </Card>
            )
          })()}

          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This will {rangeMode === "new" ? "create a new Ludus range and deploy" : "deploy"}{" "}
              {labInfo?.vmCount ?? "multiple"} VMs
              {rangeMode === "existing" && selectedExistingRange
                ? <> to range <strong>{selectedExistingRange}</strong></>
                : " to a new dedicated Ludus range"}
              . The deployment can take 30–90 minutes depending on the lab and extensions selected.
            </AlertDescription>
          </Alert>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={handleDeploy} disabled={isRunning || creatingRange} className="min-w-36">
              {creatingRange
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating range...</>
                : <><Play className="h-4 w-4" /> Deploy Instance</>}
            </Button>
          </div>
        </div>
      )}

      {/* ── Side-by-side terminal view ─────────────────────────────────── */}
      {step === 3 && showTerminal && (
        <>
          {/* Status bar */}
          <div className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3 text-sm flex-wrap">
              {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <span className="text-muted-foreground">
                Deploying <code className="text-primary font-mono">{selectedLab}</code>
              </span>
              {dedicatedRangeId && (
                <Badge variant="success" className="gap-1">
                  <Server className="h-3 w-3" /> range: {dedicatedRangeId}
                </Badge>
              )}
              {/* Range deploy phase indicator */}
              {isRangeStreaming && (
                <Badge variant="warning" className="gap-1">
                  <Server className="h-3 w-3" /> Provisioning VMs
                </Badge>
              )}
              {!isRangeStreaming && rangeState === "SUCCESS" && (
                <Badge variant="success" className="gap-1">
                  <Server className="h-3 w-3" /> VMs Ready
                </Badge>
              )}
              {!isRangeStreaming && rangeState && rangeState !== "SUCCESS" && rangeLogLines.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Server className="h-3 w-3" /> {rangeState}
                </Badge>
              )}
              {exitCode !== null && (exitCode === 0
                ? <Badge variant="success">GOAD Complete</Badge>
                : <Badge variant="destructive">GOAD Failed (exit {exitCode})</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {isRunning && (
                <Button size="sm" variant="destructive" onClick={handleStop}>
                  <StopCircle className="h-3.5 w-3.5" /> Stop
                </Button>
              )}
              {exitCode === 0 && (
                <Button size="sm" asChild>
                  <Link href="/goad"><Terminal className="h-3.5 w-3.5" /> View All Labs</Link>
                </Button>
              )}
            </div>
          </div>

          {/* Side-by-side panels */}
          <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
            {/* Left: Ludus Range Logs */}
            <GoadTerminal
              lines={rangeLogLines}
              onClear={clearRangeLogs}
              label={`Range Logs — Ludus VM Deploy${isRangeStreaming ? " (live)" : rangeState ? ` · ${rangeState}` : ""}`}
              className="flex flex-col min-h-0 h-full"
            />

            {/* Right: GOAD Logs */}
            <GoadTerminal
              lines={lines}
              onClear={clear}
              label={`GOAD Logs — ${selectedLab ?? ""}${isRunning ? " (running)" : exitCode !== null ? ` · exit ${exitCode}` : ""}`}
              className="flex flex-col min-h-0 h-full"
            />
          </div>
        </>
      )}
    </div>
  )
}
