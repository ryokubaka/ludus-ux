/**
 * Guard Packer buildTemplates so already-built templates are never rebuilt
 * just because the model ignored built:true in listTemplates.
 */

import { parseLudusTemplateBuiltMap } from "@/lib/assistant/goad-catalog-assist"
import { LUDUS_DEFAULT_ROUTER_TEMPLATE } from "@/lib/ludus-router-template"

export function extractBuildTemplateNames(body: unknown): string[] {
  if (!body || typeof body !== "object") return []
  const templates = (body as { templates?: unknown }).templates
  if (!Array.isArray(templates)) return []
  const names: string[] = []
  for (const item of templates) {
    if (typeof item === "string" && item.trim()) {
      names.push(item.trim())
      continue
    }
    if (item && typeof item === "object") {
      const n = (item as { name?: unknown }).name
      if (typeof n === "string" && n.trim()) names.push(n.trim())
    }
  }
  return [...new Set(names)]
}

export type BuildTemplatesGuardResult =
  | { ok: true; toBuild: string[] }
  | {
      ok: false
      error: string
      assistant_hint: string
      alreadyBuilt: string[]
      needBuild: string[]
      missing: string[]
    }

/** Compare requested Packer names against live Ludus template built map. */
export function guardBuildTemplatesAgainstBuiltMap(
  requested: string[],
  builtMap: Map<string, boolean>,
): BuildTemplatesGuardResult {
  if (requested.length === 0) {
    return {
      ok: false,
      error: "buildTemplates requires body.templates as a non-empty name array.",
      assistant_hint:
        "Pass body: { templates: [\"exact-name-from-listTemplates\"] }. Only include names with built:false.",
      alreadyBuilt: [],
      needBuild: [],
      missing: [],
    }
  }

  const alreadyBuilt: string[] = []
  const needBuild: string[] = []
  const missing: string[] = []
  for (const name of requested) {
    if (!builtMap.has(name)) missing.push(name)
    else if (builtMap.get(name)) alreadyBuilt.push(name)
    else needBuild.push(name)
  }

  if (alreadyBuilt.length > 0 && needBuild.length === 0 && missing.length === 0) {
    return {
      ok: false,
      error: `Refused: template(s) already built — do not Packer-rebuild: ${alreadyBuilt.join(", ")}`,
      assistant_hint:
        "These templates are already built:true. Do NOT call buildTemplates again. " +
        "For GOAD: templates are ready — continue ask_user wizard / createRange + executeGoad (call_lux_api). " +
        "Ignore other not_built templates that are not required.",
      alreadyBuilt,
      needBuild,
      missing,
    }
  }

  if (alreadyBuilt.length > 0) {
    return {
      ok: false,
      error: `Refused: remove already-built names from body.templates: ${alreadyBuilt.join(", ")}`,
      assistant_hint:
        `Already built (skip): ${alreadyBuilt.join(", ")}. ` +
        (needBuild.length ? `Only build these: ${needBuild.join(", ")}. ` : "") +
        (missing.length
          ? `Missing/not registered (addTemplates first): ${missing.join(", ")}. `
          : "") +
        "Retry buildTemplates with ONLY needBuild names, or skip Packer and continue the deploy wizard.",
      alreadyBuilt,
      needBuild,
      missing,
    }
  }

  if (needBuild.length === 0 && missing.length > 0) {
    return {
      ok: false,
      error: `Refused: template(s) not registered — cannot Packer-build yet: ${missing.join(", ")}`,
      assistant_hint:
        "Call LUX listTemplateSources → addTemplates for missing names first, then buildTemplates. Do not invent names.",
      alreadyBuilt,
      needBuild,
      missing,
    }
  }

  return { ok: true, toBuild: needBuild }
}

export type CompactTemplateList = {
  built: string[]
  not_built: string[]
  /** Full rows kept for exact fields; prefer built/not_built for decisions. */
  templates: unknown
  assistant_note: string
}

/** Compact listTemplates payload so models do not fixate on unrelated not_built rows. */
export function summarizeTemplatesForAssistant(data: unknown): CompactTemplateList {
  const builtMap = parseLudusTemplateBuiltMap(data)
  const built: string[] = []
  const not_built: string[] = []
  for (const [name, isBuilt] of builtMap) {
    if (isBuilt) built.push(name)
    else not_built.push(name)
  }
  built.sort()
  not_built.sort()
  return {
    built,
    not_built,
    templates: data,
    assistant_note:
      "Use built[] / not_built[]. NEVER buildTemplates for names in built[]. " +
      `Router template ${LUDUS_DEFAULT_ROUTER_TEMPLATE} must be in built[] before any range deploy / executeGoad. ` +
      "GOAD: only build names in the matched lab templateAudit.needBuild (or not_built ∩ requiredTemplates).",
  }
}
