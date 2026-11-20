import { inferGoadLabName } from "@/lib/goad/goad-wizard-args"

/** Catalog fields the deploy offer needs. The live catalog has more. */
export interface GoadPlanLab {
  name: string
  description?: string
  ludusSupported?: boolean
}

export interface GoadPlanExtension {
  name: string
  description?: string
  compatibility?: string[]
}

export interface GoadPlanCatalog {
  labs: GoadPlanLab[]
  extensions: GoadPlanExtension[]
}

export interface GoadDeployIntent {
  rangeId: string
  labHint: string
}

const NAME = /^[A-Za-z0-9_.-]{1,64}$/

/**
 * A request to deploy a named GOAD lab on a named range.
 * "Using rangeb range, I want to deploy GOAD-Mini" is one.
 */
/** "Build me a Ludus range" has no lab yet. A named GOAD lab stays on the GOAD path. */
export function matchOpenRangeRequest(question: string): boolean {
  const text = question.trim()
  if (!/\b(build|create|make)\b/i.test(text) || !/\brange\b/i.test(text)) return false
  const named = matchGoadDeployRequest(text)
  return !named || named.labHint === ""
}

export function matchGoadDeployRequest(question: string): GoadDeployIntent | null {
  const text = question.trim()
  const verb = /\b(deploy|install|provision|create|make|build)\b/i.test(text)
  const aboutRange = /\brange\b/i.test(text)
  if (!text || !verb || !/\bgoad\b/i.test(text)) return null
  if (!/\b(deploy|install|provision)\b/i.test(text) && !aboutRange) return null
  const labHint = inferGoadLabName(text)
  if (!labHint || !NAME.test(labHint)) return null
  const rangeId = matchRangeId(text)
  if (!rangeId) return { rangeId: "", labHint }
  return { rangeId, labHint }
}

function matchRangeId(question: string): string {
  const skip = new Set(["using", "a", "the", "new", "me", "with", "for", "my", "this", "that", "an", "id"])
  const patterns = [
    /\busing\s+([A-Za-z0-9_-]{1,64})\s+range\b/i,
    /\bon\s+range\s+([A-Za-z0-9_-]{1,64})\b/i,
    /\brange\s+id\s+([A-Za-z0-9_-]{1,64})\b/i,
    /\brange\s+([A-Za-z0-9_-]{1,64})\b/i,
  ]
  for (const pattern of patterns) {
    const match = question.match(pattern)
    const id = match?.[1] ?? ""
    if (NAME.test(id) && !skip.has(id.toLowerCase())) return id
  }
  return ""
}

export type GoadDeployResolution =
  | {
      ok: true
      rangeId: string
      lab: string
      description: string
      extensions: Array<{ name: string; description: string }>
    }
  | { ok: false; reason: "missing-range" | "missing-lab"; labHint: string; available: string[] }

/** Match the hint to a Ludus-supported catalog lab and the extensions that lab accepts. */
export function resolveGoadDeployPlan(intent: GoadDeployIntent, catalog: GoadPlanCatalog): GoadDeployResolution {
  const available = catalog.labs
    .filter((lab) => lab.ludusSupported !== false && NAME.test(lab.name))
    .map((lab) => lab.name)
  const lab = catalog.labs.find(
    (item) => item.ludusSupported !== false && item.name.toLowerCase() === intent.labHint.toLowerCase(),
  )
  if (!lab || !NAME.test(lab.name)) {
    return { ok: false, reason: "missing-lab", labHint: intent.labHint, available }
  }
  if (!intent.rangeId) {
    return { ok: false, reason: "missing-range", labHint: lab.name, available }
  }
  const extensions = catalog.extensions
    .filter((ext) => NAME.test(ext.name) && extensionFits(ext, lab.name))
    .map((ext) => ({ name: ext.name, description: (ext.description || "").trim() }))
  return {
    ok: true,
    rangeId: intent.rangeId,
    lab: lab.name,
    description: (lab.description || "").trim(),
    extensions,
  }
}

function extensionFits(ext: GoadPlanExtension, lab: string): boolean {
  const list = ext.compatibility ?? ["*"]
  if (list.length === 0 || list.includes("*")) return true
  return list.some((name) => name.toLowerCase() === lab.toLowerCase())
}
