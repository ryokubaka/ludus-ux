/**
 * Helpers so the assistant matches the user's GOAD lab (e.g. GOAD-Mini)
 * instead of grabbing labs[0] (often ADFS alphabetically),
 * and audits that lab's template deps before build/deploy.
 */

import { withRouterTemplateRequired, LUDUS_DEFAULT_ROUTER_TEMPLATE } from "@/lib/ludus-router-template"

export function normalizeGoadLabKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
}

/** Find catalog lab by user request (GOAD-Mini, goad_mini, mini, …). */
export function matchGoadLabByRequest(
  labs: Array<{ name: string }>,
  userRequest: string,
): { name: string } | null {
  const hay = normalizeGoadLabKey(userRequest)
  if (!hay || !labs.length) return null

  const normalized = labs.map((l) => ({ l, n: normalizeGoadLabKey(l.name) }))

  const exact = normalized.find((x) => x.n === hay)
  if (exact) return exact.l

  // Prefer longest lab name that appears inside the user text (GOAD-Mini over GOAD).
  const contained = normalized
    .filter((x) => x.n.length >= 3 && hay.includes(x.n))
    .sort((a, b) => b.n.length - a.n.length)
  if (contained[0]) return contained[0].l

  return null
}

export type TemplateDepAudit = {
  /** Exact names from catalog — only these matter for this lab. */
  required: string[]
  /** Registered + Packer-built — ready. */
  built: string[]
  /** Registered but built:false — only these may be Packer-built. */
  needBuild: string[]
  /** Not registered at all — addTemplates first, then build. */
  missing: string[]
  ready: boolean
}

export type GoadLabAssistRow = {
  name: string
  requiredTemplates: string[]
  ludusSupported: boolean
  vmCount: number
  /** Present when Ludus template list was joined at tool time. */
  templateAudit?: TemplateDepAudit
}

export type GoadCatalogAssistSummary = {
  configured: boolean
  goadPath: string
  /** Quick index — match the user's lab against these names, never labs[0]. */
  labNames: string[]
  labs: GoadLabAssistRow[]
  extensionNames: string[]
  /** True when templateAudit was attached from live Ludus listTemplates. */
  templateStatusJoined: boolean
  assistant_hint: string
}

/** Parse Ludus GET /templates payload into name → built. */
export function parseLudusTemplateBuiltMap(data: unknown): Map<string, boolean> {
  const map = new Map<string, boolean>()
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { templates?: unknown }).templates)
      ? (data as { templates: unknown[] }).templates
      : null
  if (!rows) return map
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const name = typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name.trim() : ""
    if (!name) continue
    const built = (row as { built?: unknown }).built === true
    map.set(name, built)
  }
  return map
}

/** Compare one lab's requiredTemplates against installed Ludus templates. */
export function auditRequiredTemplates(
  required: string[],
  builtMap: Map<string, boolean>,
): TemplateDepAudit {
  const built: string[] = []
  const needBuild: string[] = []
  const missing: string[] = []
  for (const name of required) {
    if (!builtMap.has(name)) missing.push(name)
    else if (builtMap.get(name)) built.push(name)
    else needBuild.push(name)
  }
  return {
    required: [...required],
    built,
    needBuild,
    missing,
    ready: needBuild.length === 0 && missing.length === 0,
  }
}

function goadDeployHint(joined: boolean): string {
  const base =
    "CRITICAL: Match the user's lab by name from labNames (e.g. GOAD-Mini). NEVER use labs[0] / first entry (often ADFS). " +
    "Read skills/ludus-ux/references/workflows/goad-deploy.md. " +
    "First ask_user path: lux_goad vs ludus_blueprint (buttons). GOAD APIs = call_lux_api only. "
  const phase1 = joined
    ? "PHASE 1 (before wizard steps / buildTemplates / executeGoad): open the matched lab's templateAudit. " +
      `ALWAYS include ${LUDUS_DEFAULT_ROUTER_TEMPLATE} (Ludus router — required for every range). ` +
      "Report Ready vs needBuild vs missing. " +
      "built[] → never rebuild. needBuild[] → buildTemplates those names only. missing[] → addTemplates then build. " +
      "Ignore unrelated not_built rows. Then GET /ansible. " +
      "Then prefer one ask_user card bundling: extensions from full extensionNames + None (NOT lab names) + range new|existing + network skip|custom → if new ask rangeID text → if custom ask network YAML → confirm → createRange {rangeID,name} + executeGoad. "
    : "PHASE 1: listTemplates and audit ONLY that lab's requiredTemplates " +
      `(plus ${LUDUS_DEFAULT_ROUTER_TEMPLATE} router). Never rebuild built names. Then GET /ansible. ` +
      "Then sequential ask_user wizard per goad-deploy.md. "
  return (
    base +
    phase1 +
    "Do not eject to /goad and stop unless the user asks for the UI. " +
    "Never invent --dedicated (createRange + executeGoad rangeId). " +
    "executeGoad body.args must be one CLI string (not array, not labName alone)."
  )
}

export function summarizeGoadCatalogForAssistant(
  data: unknown,
  templatesData?: unknown,
): GoadCatalogAssistSummary | null {
  if (!data || typeof data !== "object") return null
  const raw = data as {
    configured?: boolean
    goadPath?: string
    labs?: Array<{
      name?: string
      requiredTemplates?: string[]
      ludusSupported?: boolean
      vmCount?: number
    }>
    extensions?: Array<{ name?: string }>
  }
  const builtMap =
    templatesData !== undefined ? parseLudusTemplateBuiltMap(templatesData) : null
  const templateStatusJoined = builtMap !== null

  const labs: GoadLabAssistRow[] = (raw.labs || [])
    .filter((l) => typeof l?.name === "string" && l.name.trim())
    .map((l) => {
      const requiredTemplates = Array.isArray(l.requiredTemplates)
        ? l.requiredTemplates.filter((t): t is string => typeof t === "string")
        : []
      const row: GoadLabAssistRow = {
        name: l.name!.trim(),
        requiredTemplates,
        ludusSupported: l.ludusSupported !== false,
        vmCount: typeof l.vmCount === "number" ? l.vmCount : 0,
      }
      if (builtMap) {
        row.templateAudit = auditRequiredTemplates(
          withRouterTemplateRequired(requiredTemplates),
          builtMap,
        )
      }
      return row
    })
  const extensionNames = (raw.extensions || [])
    .map((e) => (typeof e?.name === "string" ? e.name.trim() : ""))
    .filter(Boolean)

  return {
    configured: raw.configured === true,
    goadPath: typeof raw.goadPath === "string" ? raw.goadPath : "",
    labNames: labs.map((l) => l.name),
    labs,
    extensionNames,
    templateStatusJoined,
    assistant_hint: goadDeployHint(templateStatusJoined),
  }
}
