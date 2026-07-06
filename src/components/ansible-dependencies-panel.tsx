"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { queryKeys } from "@/lib/query-keys"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import type { BlueprintRequirement } from "@/lib/blueprint-dependencies"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, BookOpen, Check, Download, Loader2, RefreshCw } from "lucide-react"

export interface DependencyCheckResult {
  required: BlueprintRequirement[]
  missing: BlueprintRequirement[]
  ready: boolean
}

export interface DependencyInstallResult {
  failed: Array<{ name: string; error: string }>
}

export interface AnsibleDependenciesPanelProps {
  onCheck: () => Promise<DependencyCheckResult>
  onInstall: (missing: BlueprintRequirement[]) => Promise<DependencyInstallResult>
  onRefresh: () => Promise<DependencyCheckResult>
  onReadyChange?: (ready: boolean) => void
  compact?: boolean
  /** Text describing what references the dependencies (e.g. "blueprint" or "GOAD configuration"). */
  subjectLabel?: string
  /** Text describing what will fail without them (e.g. "applying the config" or "deploying"). */
  failureAction?: string
  /** Extra content rendered after the missing list when dependencies are not all installed. */
  extraMissingInfo?: React.ReactNode
  /** When true, hide the ready state if no items are required. */
  hideReadyWhenEmpty?: boolean
}

export function AnsibleDependenciesPanel({
  onCheck,
  onInstall,
  onRefresh,
  onReadyChange,
  compact = false,
  subjectLabel = "blueprint",
  failureAction = "applying the config",
  extraMissingInfo,
  hideReadyWhenEmpty = false,
}: AnsibleDependenciesPanelProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const [check, setCheck] = useState<DependencyCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await onCheck()
      setCheck(result)
      onReadyChange?.(result.ready)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      onReadyChange?.(false)
    } finally {
      setLoading(false)
    }
  }, [onCheck, onReadyChange])

  useEffect(() => {
    void runCheck()
  }, [runCheck])

  const handleInstall = async () => {
    if (!check || check.missing.length === 0) return
    setInstalling(true)
    try {
      const result = await onInstall(check.missing)
      await queryClient.invalidateQueries({ queryKey: queryKeys.ansible(scopeTag) })

      const refreshed = await onRefresh()
      setCheck(refreshed)
      onReadyChange?.(refreshed.ready)

      if (refreshed.ready) {
        toast({
          title: "Dependencies installed",
          description: "All required Ansible roles and collections are present.",
        })
        return
      }

      if (result.failed.length > 0) {
        toast({
          variant: "destructive",
          title: "Some dependencies failed to install",
          description: result.failed.map((f) => `${f.name}: ${f.error}`).join("; "),
        })
        return
      }

      toast({
        variant: "destructive",
        title: "Dependencies still missing",
        description: "Retry install or add items manually on the Ansible page.",
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: msg,
          slowTitle: "Slow response from Ludus",
          onSlow: () => void runCheck(),
        })
      ) {
        return
      }
      toast({ variant: "destructive", title: "Install failed", description: msg })
    } finally {
      setInstalling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking Ansible dependencies…
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive" className="text-sm">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not verify dependencies</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void runCheck()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!check) return null

  if (check.ready) {
    if (hideReadyWhenEmpty && check.required.length === 0) return null
    return (
      <div className={`flex items-start gap-2 rounded-md border border-status-success/30 bg-status-success/5 ${compact ? "p-2" : "p-3"}`}>
        <Check className="h-4 w-4 text-status-success shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-status-success">Ansible dependencies ready</p>
          {!compact && check.required.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {check.required.length} required item{check.required.length !== 1 ? "s" : ""} installed on this Ludus account.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <Alert className="text-sm border-amber-500/40 bg-amber-500/5">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>Missing Ansible dependencies</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          This {subjectLabel} references roles or collections that are not installed on your Ludus server.
          Install them before {failureAction} or deployment will fail.
        </p>
        <ul className="space-y-1.5">
          {check.missing.map((req) => (
            <li key={`${req.kind}:${req.name}`} className="flex items-start gap-2 text-xs">
              <Badge variant="outline" className="font-mono shrink-0">
                {req.kind}
              </Badge>
              <span className="font-mono break-all">{req.name}</span>
              {req.version && <span className="text-muted-foreground shrink-0">{req.version}</span>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={installing}
            onClick={() => void handleInstall()}
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Install dependencies
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={installing}
            onClick={() => void runCheck()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-check
          </Button>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" asChild>
            <Link href="/ansible">
              <BookOpen className="h-3.5 w-3.5" />
              Ansible page
            </Link>
          </Button>
        </div>
        {extraMissingInfo}
      </AlertDescription>
    </Alert>
  )
}
