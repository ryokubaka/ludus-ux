"use client"

import { useCallback } from "react"
import { AnsibleDependenciesPanel } from "@/components/ansible-dependencies-panel"
import {
  checkGoadDeployDependencies,
  installGoadDependencies,
  refreshGoadDependencyCheck,
} from "@/lib/goad-dependency-service"

interface GoadAnsibleDependenciesPanelProps {
  configYaml: string
  /** When false, skip checks (e.g. preview still loading). */
  enabled?: boolean
  onReadyChange?: (ready: boolean) => void
  compact?: boolean
}

export function GoadAnsibleDependenciesPanel({
  configYaml,
  enabled = true,
  onReadyChange,
  compact = false,
}: GoadAnsibleDependenciesPanelProps) {
  const handleCheck = useCallback(async () => {
    if (!configYaml.trim()) {
      return { required: [], missing: [], ready: true }
    }
    return checkGoadDeployDependencies(configYaml)
  }, [configYaml])

  const handleInstall = useCallback(
    async (missing: Parameters<typeof installGoadDependencies>[0]) => {
      return installGoadDependencies(missing)
    },
    [],
  )

  const handleRefresh = useCallback(async () => {
    return refreshGoadDependencyCheck(configYaml)
  }, [configYaml])

  if (!enabled) return null

  return (
    <AnsibleDependenciesPanel
      onCheck={handleCheck}
      onInstall={handleInstall}
      onRefresh={handleRefresh}
      onReadyChange={onReadyChange}
      compact={compact}
      subjectLabel="GOAD configuration"
      failureAction="deploying"
      hideReadyWhenEmpty
    />
  )
}
