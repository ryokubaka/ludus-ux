import { ludusApi } from "@/lib/ui/api"
import { fetchInstalledAnsible } from "@/lib/ansible/ansible-requirements-service"
import {
  missingRoleFromLudusError,
  rewriteConfigToInstalledRoles,
  rewriteRoleNameInConfig,
  roleSpellingsToTry,
} from "@/lib/blueprints/blueprint-dependencies"
import { canonicalRangeYaml } from "@/lib/range/range-builder-document"
import { substituteRangeIdInConfig } from "@/lib/templates/range-config-templates"

function isHttp404(error: string | undefined): boolean {
  if (!error) return false
  return /HTTP 404\b/i.test(error) || /\b404 Not Found\b/i.test(error)
}

export function readLudusConfigYaml(data: unknown): string {
  if (typeof data === "string") return data
  if (!data || typeof data !== "object") return ""
  const result = (data as { result?: unknown }).result
  return typeof result === "string" ? result : ""
}

function extractConfigYaml(data: unknown): string {
  return readLudusConfigYaml(data)
}

export type BlueprintCanvasYamlSource = "range" | "blueprint" | "unchanged"

/**
 * YAML the builder should draw after a blueprint apply.
 * A range config that changed wins (role-name rewrites stay).
 * When the range file is unchanged, the blueprint config is the picture.
 */
export function pickBlueprintCanvasYaml(
  previousCanonical: string | null,
  rangeYaml: string,
  blueprintYaml: string,
): { yaml: string; canonical: string; source: BlueprintCanvasYamlSource } {
  const rangeCanonical = canonicalOrEmpty(rangeYaml)
  const blueprintCanonical = canonicalOrEmpty(blueprintYaml)
  if (rangeCanonical && rangeCanonical !== previousCanonical) {
    return { yaml: rangeYaml.trim(), canonical: rangeCanonical, source: "range" }
  }
  if (blueprintCanonical && blueprintCanonical !== rangeCanonical) {
    return { yaml: blueprintYaml.trim(), canonical: blueprintCanonical, source: "blueprint" }
  }
  if (rangeCanonical) {
    return { yaml: rangeYaml.trim(), canonical: rangeCanonical, source: "unchanged" }
  }
  if (blueprintCanonical) {
    return { yaml: blueprintYaml.trim(), canonical: blueprintCanonical, source: "blueprint" }
  }
  return { yaml: "", canonical: "", source: "unchanged" }
}

function canonicalOrEmpty(yaml: string): string {
  const trimmed = yaml.trim()
  if (!trimmed) return ""
  try {
    return canonicalRangeYaml(trimmed)
  } catch {
    return ""
  }
}

export type BlueprintApplyMethod = "apply" | "config"

export interface BlueprintApplyResult {
  ok: boolean
  method?: BlueprintApplyMethod
  error?: string
  status: number
}

/**
 * Apply a blueprint to a range. Prefer Ludus POST /blueprints/{id}/apply (handles
 * {{ range_id }} substitution). Fall back to resolved YAML + PUT /range/config on 404.
 */
export async function applyBlueprintToRange(
  blueprintId: string,
  rangeId: string,
  configYaml?: string,
): Promise<BlueprintApplyResult> {
  const rid = rangeId.trim()
  if (!rid) {
    return { ok: false, error: "Range ID is required", status: 400 }
  }

  const prepared = await putInstalledRoleNames(rid, configYaml)
  if (prepared) return prepared

  const applied = await ludusApi.applyBlueprint(blueprintId, rid)
  if (!applied.error) {
    return { ok: true, method: "apply", status: applied.status }
  }

  if (missingRoleFromLudusError(applied.error)) {
    const recovered = await applyWithInstalledRoleNames(blueprintId, rid, applied.error, configYaml)
    if (recovered) return recovered
  }

  if (!isHttp404(applied.error)) {
    return { ok: false, error: applied.error, status: applied.status }
  }

  const cfg = await ludusApi.getBlueprintConfig(blueprintId)
  if (cfg.error || !cfg.data) {
    return {
      ok: false,
      error: cfg.error || applied.error || "Blueprint config fetch failed",
      status: cfg.status || applied.status,
    }
  }

  const yaml = substituteRangeIdInConfig(extractConfigYaml(cfg.data), rid)
  if (!yaml.trim()) {
    return { ok: false, error: "Blueprint config is empty", status: 400 }
  }

  const uploaded = await ludusApi.setRangeConfig(yaml, rid, true)
  if (uploaded.error) {
    return { ok: false, error: uploaded.error, status: uploaded.status }
  }

  return { ok: true, method: "config", status: uploaded.status }
}

/** When the account's role directory name differs from the blueprint, write that name first. */
async function putInstalledRoleNames(
  rangeId: string,
  configYaml: string | undefined,
): Promise<BlueprintApplyResult | null> {
  const raw = configYaml?.trim()
  if (!raw) return null
  let installed
  try {
    installed = await fetchInstalledAnsible()
  } catch {
    return null
  }
  const yaml = substituteRangeIdInConfig(raw, rangeId)
  const rewritten = rewriteConfigToInstalledRoles(yaml, installed)
  if (rewritten === yaml) return null
  const uploaded = await ludusApi.setRangeConfig(rewritten, rangeId, true)
  if (uploaded.error) return null
  return { ok: true, method: "config", status: uploaded.status }
}

async function applyWithInstalledRoleNames(
  blueprintId: string,
  rangeId: string,
  error: string,
  configYaml?: string,
): Promise<BlueprintApplyResult | null> {
  let installed
  try {
    installed = await fetchInstalledAnsible()
  } catch {
    return null
  }

  let yaml = configYaml?.trim() ? substituteRangeIdInConfig(configYaml, rangeId) : ""
  if (!yaml.trim()) {
    const cfg = await ludusApi.getBlueprintConfig(blueprintId)
    if (cfg.error || !cfg.data) return null
    yaml = substituteRangeIdInConfig(extractConfigYaml(cfg.data), rangeId)
  }
  if (!yaml.trim()) return null

  let current = error
  const tried = new Set<string>()
  for (let attempt = 0; attempt < 8; attempt++) {
    const missing = missingRoleFromLudusError(current)
    if (!missing) return null
    const spellings = roleSpellingsToTry(missing, installed).filter((name) => !tried.has(name.toLowerCase()))
    if (spellings.length === 0) return null
    let advanced = false
    for (const accepted of spellings) {
      tried.add(accepted.toLowerCase())
      const next = rewriteRoleNameInConfig(yaml, missing, accepted)
      if (next === yaml) continue
      const uploaded = await ludusApi.setRangeConfig(next, rangeId, true)
      if (!uploaded.error) return { ok: true, method: "config", status: uploaded.status }
      const nextMissing = missingRoleFromLudusError(uploaded.error)
      current = uploaded.error
      if (nextMissing && nextMissing.toLowerCase() !== missing.toLowerCase()) {
        yaml = next
        advanced = true
        break
      }
    }
    if (!advanced) return null
  }
  return null
}
