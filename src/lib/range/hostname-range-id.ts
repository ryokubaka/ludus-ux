import yaml from "js-yaml"

const RANGE_ID_TOKEN = /\{\{\s*range_id\s*\}\}/i
const RANGE_ID_PREFIX_ROOM = "{{ range_id }}-".length

const YAML_DUMP_OPTS = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  quotingType: '"' as const,
  forceQuotes: false,
}

/** Shown when an operator types `{{ range_id }}` into a hostname. */
export const RANGE_ID_HOSTNAME_NOTE =
  "{{ range_id }} stays on the VM name. The hostname is saved without it."

export function hostnameIncludesRangeId(hostname: string): boolean {
  return RANGE_ID_TOKEN.test(hostname)
}

/** Computer name with every range-id token removed. An empty result keeps the original. */
export function hostnameWithoutRangeId(hostname: string): string {
  const next = hostname.replace(/\{\{\s*range_id\s*\}\}-?/gi, "").trim().replace(/^-+|-+$/g, "")
  return next || hostname
}

/** Keep a Windows or Linux length cap, with room to type `{{ range_id }}` first. */
export function clampHostnameDraft(value: string, max: number): string {
  if (hostnameIncludesRangeId(value)) return value.slice(0, max + RANGE_ID_PREFIX_ROOM)
  return value.slice(0, max)
}

/**
 * Drop `{{ range_id }}` from every `hostname`, including Linux and the router.
 * `vm_name` is left as written. The original text is returned when nothing changes.
 */
export function stripRangeIdHostnames(yamlText: string): string {
  let doc: Record<string, unknown>
  try {
    const parsed = yaml.load(yamlText)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return yamlText
    doc = parsed as Record<string, unknown>
  } catch {
    return yamlText
  }
  if (!stripHostnamesInRoot(doc)) return yamlText
  return yaml.dump(doc, YAML_DUMP_OPTS)
}

/** True when a parsed hostname, or a `hostname:` line, still contains the token. */
export function yamlHostnamesIncludeRangeId(yamlText: string): boolean {
  try {
    const parsed = yaml.load(yamlText)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (rootHostnameHasRangeId(parsed as Record<string, unknown>)) return true
    }
  } catch {
    /* A half-edited file still explains from the hostname line. */
  }
  return /^\s*hostname:.*\{\{\s*range_id\s*\}\}/im.test(yamlText)
}

export function appendRangeIdHostnameNote(sourceYaml: string, text: string): string {
  if (!yamlHostnamesIncludeRangeId(sourceYaml)) return text
  return `${text} ${RANGE_ID_HOSTNAME_NOTE}`
}

/** Mutates `root`. Returns true when a hostname changed. */
export function stripHostnamesInRoot(root: Record<string, unknown>): boolean {
  let changed = false
  if (Array.isArray(root.ludus)) {
    for (const item of root.ludus) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue
      if (stripHostnameField(item as Record<string, unknown>)) changed = true
    }
  }
  const router = root.router
  if (router && typeof router === "object" && !Array.isArray(router)) {
    if (stripHostnameField(router as Record<string, unknown>)) changed = true
  }
  return changed
}

function stripHostnameField(record: Record<string, unknown>): boolean {
  if (typeof record.hostname !== "string") return false
  const next = hostnameWithoutRangeId(record.hostname)
  if (next === record.hostname) return false
  record.hostname = next
  return true
}

function rootHostnameHasRangeId(root: Record<string, unknown>): boolean {
  if (Array.isArray(root.ludus)) {
    for (const item of root.ludus) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue
      const hostname = (item as Record<string, unknown>).hostname
      if (typeof hostname === "string" && hostnameIncludesRangeId(hostname)) return true
    }
  }
  const router = root.router
  if (router && typeof router === "object" && !Array.isArray(router)) {
    const hostname = (router as Record<string, unknown>).hostname
    if (typeof hostname === "string" && hostnameIncludesRangeId(hostname)) return true
  }
  return false
}
