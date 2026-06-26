import { ludusApi } from "@/lib/api"
import {
  findMissingRequirements,
  mergeBlueprintRequirements,
  parseRequirementsYaml,
  requirementsFromConfigYaml,
  resolveBlueprintRequirements,
  type BlueprintRequirement,
} from "@/lib/blueprint-dependencies"
import {
  fetchInstalledAnsible,
  installMissingAnsibleRequirements,
} from "@/lib/ansible-requirements-service"

export interface BlueprintDependencyCheck {
  blueprintId: string
  required: BlueprintRequirement[]
  missing: BlueprintRequirement[]
  ready: boolean
  requirementsYaml?: string
  detailAvailable: boolean
}

interface AnsibleInstallResult {
  name?: string
  ok?: boolean
  error?: string
  type?: string
  version?: string
}

function isHttp404(error: string | undefined): boolean {
  if (!error) return false
  return /HTTP 404\b/i.test(error) || /\b404 Not Found\b/i.test(error)
}

async function fetchBlueprintRequirementsYaml(blueprintId: string): Promise<{
  requirementsYaml?: string
  detailAvailable: boolean
}> {
  const detail = await ludusApi.getBlueprintDetail(blueprintId)
  if (detail.error) {
    if (isHttp404(detail.error)) {
      return { detailAvailable: false }
    }
    throw new Error(detail.error)
  }
  const data = detail.data
  return {
    requirementsYaml: data?.requirements_yaml?.trim() || undefined,
    detailAvailable: true,
  }
}

async function fetchBlueprintConfigYaml(blueprintId: string): Promise<string> {
  const cfg = await ludusApi.getBlueprintConfig(blueprintId)
  if (cfg.error) throw new Error(cfg.error)
  const raw = cfg.data as unknown
  const yaml =
    (raw as { result?: string })?.result ??
    (typeof raw === "string" ? raw : "")
  if (!yaml.trim()) throw new Error("Blueprint config is empty")
  return yaml
}

/** Compare blueprint requirements against installed Ansible roles/collections. */
export async function checkBlueprintDependencies(
  blueprintId: string,
): Promise<BlueprintDependencyCheck> {
  const [installed, detail, configYaml] = await Promise.all([
    fetchInstalledAnsible(),
    fetchBlueprintRequirementsYaml(blueprintId),
    fetchBlueprintConfigYaml(blueprintId),
  ])

  const required = resolveBlueprintRequirements(configYaml, detail.requirementsYaml)
  const missing = findMissingRequirements(installed, required)

  return {
    blueprintId,
    required,
    missing,
    ready: missing.length === 0,
    requirementsYaml: detail.requirementsYaml,
    detailAvailable: detail.detailAvailable,
  }
}

export interface InstallBlueprintDepsResult {
  ok: boolean
  installed: string[]
  failed: { name: string; error: string }[]
  usedBulkInstall: boolean
}

function formatInstallResults(results: AnsibleInstallResult[] | undefined): InstallBlueprintDepsResult {
  const installed: string[] = []
  const failed: { name: string; error: string }[] = []

  for (const r of results ?? []) {
    const label = r.name?.trim() || "unknown"
    if (r.ok === false) {
      failed.push({ name: label, error: r.error?.trim() || "Install failed" })
    } else {
      installed.push(label)
    }
  }

  return {
    ok: failed.length === 0,
    installed,
    failed,
    usedBulkInstall: true,
  }
}

/** Install blueprint Ansible deps via Ludus bulk endpoint, then per-item fallback. */
export async function installBlueprintDependencies(
  blueprintId: string,
  missing: BlueprintRequirement[],
): Promise<InstallBlueprintDepsResult> {
  if (missing.length === 0) {
    return { ok: true, installed: [], failed: [], usedBulkInstall: false }
  }

  const bulk = await ludusApi.installBlueprintDependencies(blueprintId, { forceRoles: true })
  if (!bulk.error && bulk.data) {
    const parsed = formatInstallResults(bulk.data.ansibleResults)
    if (parsed.ok) return parsed

    const installed = await fetchInstalledAnsible()
    const stillMissing = findMissingRequirements(installed, missing)
    if (stillMissing.length === 0) {
      return { ...parsed, ok: true }
    }
    const fallback = await installMissingAnsibleRequirements(stillMissing)
    return {
      ok: fallback.ok,
      installed: [...parsed.installed, ...fallback.installed],
      failed: [...parsed.failed, ...fallback.failed],
      usedBulkInstall: true,
    }
  }

  if (bulk.error && !isHttp404(bulk.error)) {
    const individual = await installMissingAnsibleRequirements(missing)
    if (individual.ok || individual.installed.length > 0) {
      return { ...individual, usedBulkInstall: false }
    }
    return {
      ok: false,
      installed: individual.installed,
      failed: [{ name: blueprintId, error: bulk.error }, ...individual.failed],
      usedBulkInstall: false,
    }
  }

  const individual = await installMissingAnsibleRequirements(missing)
  return { ...individual, usedBulkInstall: false }
}

/** Re-check after install; returns updated missing list. */
export async function refreshBlueprintDependencyCheck(
  blueprintId: string,
  requirementsYaml?: string,
): Promise<BlueprintDependencyCheck> {
  const [installed, configYaml] = await Promise.all([
    fetchInstalledAnsible(),
    fetchBlueprintConfigYaml(blueprintId),
  ])

  let reqYaml = requirementsYaml
  if (!reqYaml) {
    const detail = await fetchBlueprintRequirementsYaml(blueprintId)
    reqYaml = detail.requirementsYaml
  }

  const required = resolveBlueprintRequirements(configYaml, reqYaml)
  const missing = findMissingRequirements(installed, required)

  return {
    blueprintId,
    required,
    missing,
    ready: missing.length === 0,
    requirementsYaml: reqYaml,
    detailAvailable: true,
  }
}

export function requirementsFromKnownYaml(
  configYaml: string,
  requirementsYaml?: string | null,
): BlueprintRequirement[] {
  return mergeBlueprintRequirements(
    parseRequirementsYaml(requirementsYaml),
    requirementsFromConfigYaml(configYaml),
  )
}
