"use client"

import { useCallback, useEffect, useState } from "react"
import { AnsibleDependenciesPanel } from "@/components/ansible-dependencies-panel"
import {
  checkBlueprintDependencies,
  installBlueprintDependencies,
  refreshBlueprintDependencyCheck,
} from "@/lib/blueprint-dependency-service"
import { Package } from "lucide-react"

interface BlueprintDependenciesPanelProps {
  blueprintId: string
  /** Called when dependency readiness changes (all installed vs missing). */
  onReadyChange?: (ready: boolean) => void
  compact?: boolean
}

export function BlueprintDependenciesPanel({
  blueprintId,
  onReadyChange,
  compact = false,
}: BlueprintDependenciesPanelProps) {
  const [requirementsYaml, setRequirementsYaml] = useState<string | undefined>()
  const [detailAvailable, setDetailAvailable] = useState(true)

  const handleCheck = useCallback(async () => {
    const result = await checkBlueprintDependencies(blueprintId)
    setRequirementsYaml(result.requirementsYaml)
    setDetailAvailable(result.detailAvailable)
    return result
  }, [blueprintId])

  const handleInstall = useCallback(
    async (missing: Parameters<typeof installBlueprintDependencies>[1]) => {
      return installBlueprintDependencies(blueprintId, missing)
    },
    [blueprintId],
  )

  const handleRefresh = useCallback(async () => {
    const result = await refreshBlueprintDependencyCheck(blueprintId, requirementsYaml)
    setRequirementsYaml(result.requirementsYaml)
    setDetailAvailable(result.detailAvailable)
    return result
  }, [blueprintId, requirementsYaml])

  return (
    <AnsibleDependenciesPanel
      onCheck={handleCheck}
      onInstall={handleInstall}
      onRefresh={handleRefresh}
      onReadyChange={onReadyChange}
      compact={compact}
      subjectLabel="blueprint"
      failureAction="applying the config"
      extraMissingInfo={
        !detailAvailable ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" />
            requirements.yml not available from Ludus — requirements inferred from blueprint config.
          </p>
        ) : undefined
      }
    />
  )
}

export function useBlueprintDepsReady(blueprintId: string | null): {
  ready: boolean
  loading: boolean
  setReady: (ready: boolean) => void
} {
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(!!blueprintId)

  useEffect(() => {
    if (!blueprintId) {
      setReady(true)
      setLoading(false)
      return
    }
    setLoading(true)
    checkBlueprintDependencies(blueprintId)
      .then((result) => setReady(result.ready))
      .catch(() => setReady(false))
      .finally(() => setLoading(false))
  }, [blueprintId])

  return { ready, loading, setReady }
}
