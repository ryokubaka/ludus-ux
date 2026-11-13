"use client"

import { useCallback } from "react"
import { AnsibleDependenciesPanel } from "@/components/ansible-dependencies-panel"
import {
  ansibleRequirementsOnly,
  findMissingRequirements,
  findMissingTemplateRequirements,
  requirementsFromConfigYaml,
} from "@/lib/blueprints/blueprint-dependencies"
import {
  fetchInstalledAnsible,
  installMissingAnsibleRequirements,
} from "@/lib/ansible/ansible-requirements-service"
import { ludusApi } from "@/lib/ui/api"
import type { DependencyCheckResult } from "@/components/ansible-dependencies-panel"

interface BuilderAnsibleDepsPanelProps {
  /** Live range-config YAML the builder would save. */
  configYaml: string
  onReadyChange?: (ready: boolean) => void
}

/**
 * Checks the roles and collections the canvas emits against what Ludus has
 * installed, plus Packer template build state, and offers one-click install —
 * the same panel blueprints and GOAD use.
 */
export function BuilderAnsibleDepsPanel({ configYaml, onReadyChange }: BuilderAnsibleDepsPanelProps) {
  const check = useCallback(async (): Promise<DependencyCheckResult> => {
    const [installed, templatesRes] = await Promise.all([
      fetchInstalledAnsible(),
      ludusApi.listTemplates(),
    ])
    if (templatesRes.error) throw new Error(templatesRes.error)
    const required = requirementsFromConfigYaml(configYaml)
    const missingAnsible = findMissingRequirements(installed, ansibleRequirementsOnly(required))
    const missingTemplates = findMissingTemplateRequirements(required, templatesRes.data ?? [])
    const missing = [...missingAnsible, ...missingTemplates]
    return { required, missing, ready: missing.length === 0 }
  }, [configYaml])

  const install = useCallback<Parameters<typeof AnsibleDependenciesPanel>[0]["onInstall"]>(
    async (missing) => installMissingAnsibleRequirements(missing),
    [],
  )

  return (
    <AnsibleDependenciesPanel
      onCheck={check}
      onInstall={install}
      onRefresh={check}
      onReadyChange={onReadyChange}
      subjectLabel="range"
      failureAction="deploying"
      hideReadyWhenEmpty
      compact
    />
  )
}
