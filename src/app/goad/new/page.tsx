"use client"

import { useState, useEffect } from "react"
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
} from "lucide-react"
import Link from "next/link"
import type { GoadLabDef, GoadExtensionDef, GoadCatalog } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useDeployLogs } from "@/hooks/use-deploy-logs"
import { useRange } from "@/lib/range-context"

const STEPS = ["Select Lab Type", "Select Extensions", "Review & Deploy"]

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export default function NewGoadInstancePage() {
  const router = useRouter()
  const { selectedRangeId } = useRange()
  const [step, setStep] = useState(0)
  const [selectedLab, setSelectedLab] = useState<string | null>(null)
  const [selectedExtensions, setSelectedExtensions] = useState<Set<string>>(new Set())
  const [deployed, setDeployed] = useState(false)
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

  const handleDeploy = async () => {
    if (!selectedLab) return
    const exts = Array.from(selectedExtensions)
    // goad.py -l <LAB> -p ludus -m local -t install [-e ext1 -e ext2 ...]
    const extArgs = exts.map((e) => `-e ${shellQuote(e)}`).join(" ")
    const args = `-l ${shellQuote(selectedLab)} -p ludus -m local -t install${extArgs ? ` ${extArgs}` : ""}`
    setDeployed(true)
    // Start range log streaming before GOAD so we catch Ludus VM provisioning
    startRangeStreaming(selectedRangeId ?? undefined)
    await run(args)
  }

  const handleStop = async () => {
    await stop()
    stopRangeStreaming()
  }

  const labInfo: GoadLabDef | undefined = catalog?.labs.find((l) => l.name === selectedLab)

  const showTerminal = step === 2 && (deployed || isRunning)

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
                <div key={i} className="h-16 w-full rounded-lg bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : !catalogError && catalog ? (
            <div className="grid gap-3">
              {catalog.labs.map((lab) => (
                <button
                  key={lab.name}
                  className={cn(
                    "text-left p-4 rounded-lg border-2 transition-all",
                    selectedLab === lab.name
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                  onClick={() => {
                    setSelectedLab(lab.name)
                    // Clear extension selections that aren't compatible with new lab
                    setSelectedExtensions(new Set())
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono font-bold text-primary">{lab.name}</code>
                        <Badge variant="secondary" className="text-xs">{lab.vmCount} VMs</Badge>
                        {lab.domains > 0 && (
                          <Badge variant="secondary" className="text-xs">{lab.domains} domain{lab.domains !== 1 ? "s" : ""}</Badge>
                        )}
                      </div>
                      {lab.description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{lab.description}</p>
                      )}
                    </div>
                    {selectedLab === lab.name && (
                      <Check className="h-5 w-5 text-primary flex-shrink-0 ml-3" />
                    )}
                  </div>
                </button>
              ))}

              {catalog.labs.length === 0 && !catalogError && (
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
              {compatExtensions.map((ext) => (
                <div
                  key={ext.name}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                    selectedExtensions.has(ext.name)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  )}
                  onClick={() => toggleExtension(ext.name)}
                >
                  <Checkbox
                    checked={selectedExtensions.has(ext.name)}
                    onCheckedChange={() => toggleExtension(ext.name)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Puzzle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <code className="font-mono text-xs font-medium text-primary">{ext.name}</code>
                      {ext.machines.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          +{ext.machines.length} VM{ext.machines.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {ext.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{ext.description}</p>
                    )}
                    {ext.impact && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{ext.impact}</p>
                    )}
                  </div>
                </div>
              ))}
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

      {/* Step 2: Review & Deploy */}
      {step === 2 && !showTerminal && (
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

          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This will create a new GOAD instance and deploy{" "}
              {labInfo?.vmCount ?? "multiple"} VMs to your Ludus range. The deployment can take
              30–90 minutes depending on the lab and extensions selected.
            </AlertDescription>
          </Alert>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={handleDeploy} disabled={isRunning} className="min-w-36">
              <Play className="h-4 w-4" /> Deploy Instance
            </Button>
          </div>
        </div>
      )}

      {/* ── Side-by-side terminal view ─────────────────────────────────── */}
      {step === 2 && showTerminal && (
        <>
          {/* Status bar */}
          <div className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3 text-sm flex-wrap">
              {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <span className="text-muted-foreground">
                Deploying <code className="text-primary font-mono">{selectedLab}</code>
              </span>
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
