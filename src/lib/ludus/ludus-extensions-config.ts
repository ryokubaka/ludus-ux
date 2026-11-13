import yaml from "js-yaml"
import { extractNetworkSection } from "@/lib/range/network-rules"

/** Parsed top-level `ludus_extensions` from range-config (Ludus 2.3.0+). */
export type LudusExtensionsSnapshot = unknown

const YAML_DUMP_OPTS = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  quotingType: '"' as const,
  forceQuotes: false,
}

/**
 * Snapshot top-level `ludus_extensions` from range-config YAML.
 * Returns null if missing or YAML is unparseable.
 */
export function extractLudusExtensions(yamlText: string): LudusExtensionsSnapshot | null {
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null
    if (!Object.prototype.hasOwnProperty.call(doc, "ludus_extensions")) return null
    return structuredClone(doc.ludus_extensions)
  } catch {
    return null
  }
}

/**
 * Replace or remove top-level `ludus_extensions` in YAML.
 * Pass `null` to leave YAML unchanged. Use `undefined` sentinel via omit —
 * callers that need delete should pass a dedicated remove helper.
 */
export function applyLudusExtensions(
  yamlText: string,
  extensions: LudusExtensionsSnapshot | null,
): string {
  if (extensions == null) return yamlText
  let doc: Record<string, unknown>
  try {
    const parsed = yaml.load(yamlText)
    doc = (parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {}) as Record<string, unknown>
  } catch {
    doc = {}
  }
  doc.ludus_extensions = structuredClone(extensions)
  return yaml.dump(doc, YAML_DUMP_OPTS)
}

/** sync-network body. Null deletes a section the save removed; keys both documents lack are omitted. */
export function goadSidecarSyncBody(
  originalYaml: string,
  savedYaml: string,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  const savedNetwork = extractNetworkSection(savedYaml)
  const savedExtensions = extractLudusExtensions(savedYaml)
  if (savedNetwork != null) body.network = savedNetwork
  else if (extractNetworkSection(originalYaml) != null) body.network = null
  if (savedExtensions != null) body.ludus_extensions = savedExtensions
  else if (extractLudusExtensions(originalYaml) != null) body.ludus_extensions = null
  return Object.keys(body).length > 0 ? body : null
}

/** True when YAML's `ludus_extensions` matches the snapshot (js-yaml normalized). */
export function ludusExtensionsEqual(
  yamlText: string,
  snapshot: LudusExtensionsSnapshot,
): boolean {
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false
    if (!Object.prototype.hasOwnProperty.call(doc, "ludus_extensions")) return false
    return (
      yaml.dump(doc.ludus_extensions as Record<string, unknown>, YAML_DUMP_OPTS) ===
      yaml.dump(snapshot as Record<string, unknown>, YAML_DUMP_OPTS)
    )
  } catch {
    return false
  }
}
