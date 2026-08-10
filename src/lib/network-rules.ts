import yaml from "js-yaml"

// ── Types ─────────────────────────────────────────────────────────────────────

export type VlanValue = number | "wireguard" | "public" | "all"
export type Protocol = "tcp" | "udp" | "all"
export type RuleAction = "ACCEPT" | "REJECT" | "DROP"

export interface NetworkRule {
  name: string
  vlan_src: VlanValue
  vlan_dst: VlanValue
  ip_last_octet_src?: string
  ip_last_octet_dst?: string
  protocol: Protocol
  ports: string
  action: RuleAction
}

export interface NetworkConfig {
  external_default?: "ACCEPT" | "REJECT" | "DROP"
  inter_vlan_default?: "ACCEPT" | "REJECT" | "DROP"
  wireguard_vlan_default?: "ACCEPT" | "REJECT" | "DROP"
  rules?: NetworkRule[]
}

/** Parsed `network:` block from range-config YAML (may include Ludus-specific keys). */
export type NetworkSnapshot = NetworkConfig & Record<string, unknown>

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a raw vlan value from YAML (may be a number or a string keyword). */
function normalizeVlan(v: unknown): VlanValue {
  if (v === "wireguard" || v === "public" || v === "all") return v
  const n = Number(v)
  return isNaN(n) ? "all" : n
}

function normalizeProtocol(v: unknown): Protocol {
  if (v === "tcp" || v === "udp") return v
  return "all"
}

function normalizeAction(v: unknown): RuleAction {
  if (v === "REJECT" || v === "DROP") return v
  return "ACCEPT"
}

/**
 * Ludus `ip_last_octet_*` is ONLY the last octet (or N-M range), never a full IP.
 * UI users often paste `10.1.20.20` — coerce to `20` so schema validation passes.
 */
export function normalizeIpLastOctet(raw: unknown): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s) return undefined

  // Full IPv4 → last octet
  const ipv4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const last = Number(ipv4[4])
    if (Number.isInteger(last) && last >= 0 && last <= 255) return String(last)
  }

  // Single octet 0–255
  if (/^\d{1,3}$/.test(s)) {
    const n = Number(s)
    if (Number.isInteger(n) && n >= 0 && n <= 255) return String(n)
  }

  // Range N-M (Ludus docs: ip_last_octet_src: 21-25)
  const range = s.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    if (
      Number.isInteger(a) &&
      Number.isInteger(b) &&
      a >= 0 &&
      a <= 255 &&
      b >= 0 &&
      b <= 255 &&
      a <= b
    ) {
      return `${a}-${b}`
    }
  }

  // Leave as-is for caller/schema to reject; do not invent a value
  return s
}

/**
 * Ludus schema anyOf: integer single octet OR string range `N-M`.
 * JS string `"20"` dumps as YAML `"20"` and fails both branches — use number.
 */
export function octetForYaml(raw: unknown): number | string | undefined {
  const n = normalizeIpLastOctet(raw)
  if (n == null) return undefined
  if (/^\d{1,3}$/.test(n)) return Number(n)
  return n
}

/**
 * Ludus `ports`: integer | "all" | "start:end" | "a,b,c" — not a YAML array.
 * Arrays (common blueprint mistake) → comma-separated string.
 */
export function normalizePorts(raw: unknown): string {
  if (raw == null) return "all"
  if (Array.isArray(raw)) {
    const parts = raw.map((p) => String(p).trim()).filter(Boolean)
    return parts.length > 0 ? parts.join(",") : "all"
  }
  const s = String(raw).trim()
  return s || "all"
}

/** YAML dump form: bare int for single port; string for lists / ranges / all. */
export function portsForYaml(raw: unknown): number | string {
  const s = normalizePorts(raw)
  if (s === "all") return "all"
  if (/^\d+$/.test(s)) return Number(s)
  return s
}

function rawToRule(r: Record<string, unknown>): NetworkRule {
  const rule: NetworkRule = {
    name: String(r.name ?? ""),
    vlan_src: normalizeVlan(r.vlan_src),
    vlan_dst: normalizeVlan(r.vlan_dst),
    protocol: normalizeProtocol(r.protocol),
    ports: normalizePorts(r.ports),
    action: normalizeAction(r.action),
  }
  const src = normalizeIpLastOctet(r.ip_last_octet_src)
  const dst = normalizeIpLastOctet(r.ip_last_octet_dst)
  if (src != null) rule.ip_last_octet_src = src
  if (dst != null) rule.ip_last_octet_dst = dst
  return rule
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a range-config YAML string and return the network rules array.
 * Returns [] if there are none or the YAML is unparseable.
 */
export function extractNetworkRules(yamlText: string): NetworkRule[] {
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return []
    const network = doc.network as Record<string, unknown> | undefined
    if (!network || !Array.isArray(network.rules)) return []
    // Reverse on read: YAML is stored reversed (Ludus -I insert semantics), so
    // reversing here restores the order the user expects (= iptables eval order).
    return [...network.rules]
      .reverse()
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
      .map(rawToRule)
  } catch {
    return []
  }
}

/**
 * Serialize a single NetworkRule to a plain object ready for js-yaml dump.
 *
 * `ports` is always required by the Ludus schema. When `protocol` is "all",
 * ports must be "all" — the Ansible assertion that guards port values only
 * fires for specific port numbers, not the literal string "all".
 */
function ruleToPlain(rule: NetworkRule): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    name: rule.name,
    vlan_src: rule.vlan_src,
    vlan_dst: rule.vlan_dst,
    protocol: rule.protocol,
    ports: rule.protocol === "all" ? "all" : portsForYaml(rule.ports),
    action: rule.action,
  }
  const src = octetForYaml(rule.ip_last_octet_src)
  const dst = octetForYaml(rule.ip_last_octet_dst)
  if (src !== undefined) obj.ip_last_octet_src = src
  if (dst !== undefined) obj.ip_last_octet_dst = dst
  return obj
}

/**
 * Inject (or remove) network rules into a range-config YAML string.
 *
 * - If `rules` is non-empty: parse the YAML, set `network.rules`, re-dump.
 * - If `rules` is empty: remove the `network:` key entirely.
 *
 * Rules are written in REVERSED order because Ludus applies each rule via
 * `iptables -I` (insert at position 1), which reverses YAML order in the
 * chain. Reversing here ensures the order the user sees in LUX matches the
 * top-to-bottom evaluation order in iptables.
 *
 * The `ludus:` VM list and all other keys are preserved unchanged.
 * Returns the modified YAML string. Throws if the base YAML is unparseable.
 */
const YAML_DUMP_OPTS = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  quotingType: '"' as const,
  forceQuotes: false,
}

/**
 * Fix `ip_last_octet_*` for Ludus schema:
 * - full IPv4 → last octet as bare integer
 * - quoted single octet `"20"` → bare `20` (string fails integer anyOf branch)
 * Surgical replace — preserves comments/formatting.
 */
export function sanitizeNetworkIpOctetsInYaml(yamlText: string): string {
  return yamlText.replace(
    /^(\s*ip_last_octet_(?:src|dst):\s*)(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*$/gm,
    (_m, prefix: string, dq?: string, sq?: string, bare?: string) => {
      const raw = dq ?? sq ?? bare ?? ""
      const out = octetForYaml(raw)
      if (out === undefined) return _m
      return `${prefix}${out}`
    },
  )
}

/**
 * Coerce YAML list / flow-array `ports` under network rules to Ludus comma-string.
 *   ports:\n  - 8220\n  - 5055  →  ports: "8220,5055"
 *   ports: [8220, 5055]         →  ports: "8220,5055"
 */
export function sanitizeNetworkPortsInYaml(yamlText: string): string {
  let out = yamlText.replace(
    /^([ \t]*)ports:[ \t]*\n((?:[ \t]*-[ \t]*\d+[ \t]*(?:#[^\n]*)?\n?)+)/gm,
    (_m, indent: string, listBlock: string) => {
      const ports = [...listBlock.matchAll(/-[ \t]*(\d+)/g)].map((x) => x[1])
      if (ports.length === 0) return _m
      return `${indent}ports: "${ports.join(",")}"\n`
    },
  )
  out = out.replace(
    /^([ \t]*)ports:[ \t]*\[([^\]]*)\][ \t]*$/gm,
    (_m, indent: string, inner: string) => {
      const ports = inner
        .split(",")
        .map((p) => p.trim().replace(/^["']|["']$/g, ""))
        .filter((p) => /^\d+$/.test(p))
      if (ports.length === 0) return _m
      if (ports.length === 1) return `${indent}ports: ${ports[0]}`
      return `${indent}ports: "${ports.join(",")}"`
    },
  )
  return out
}

/** All surgical Ludus network.rules coercions before PUT. */
export function sanitizeNetworkRulesYaml(yamlText: string): string {
  return sanitizeNetworkPortsInYaml(sanitizeNetworkIpOctetsInYaml(yamlText))
}

export function injectNetworkRules(yamlText: string, rules: NetworkRule[]): string {
  let doc: Record<string, unknown>
  try {
    const parsed = yaml.load(yamlText)
    doc = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>
  } catch {
    doc = {}
  }

  if (rules.length === 0) {
    delete doc.network
  } else {
    const existing = (doc.network ?? {}) as Record<string, unknown>
    doc.network = {
      ...existing,
      // Reverse so that LUX display order matches iptables evaluation order
      rules: [...rules].reverse().map(ruleToPlain),
    }
  }

  return yaml.dump(doc, YAML_DUMP_OPTS)
}

/**
 * Snapshot the full `network:` object from range-config YAML (defaults + rules).
 * Returns null if missing, non-object, or unparseable.
 */
export function extractNetworkSection(yamlText: string): NetworkSnapshot | null {
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return null
    const network = doc.network
    if (!network || typeof network !== "object" || Array.isArray(network)) return null
    return structuredClone(network) as NetworkSnapshot
  } catch {
    return null
  }
}

/**
 * Replace `network:` in YAML with the given snapshot (typically restored after GOAD).
 * If `network` is null, returns `yamlText` unchanged.
 */
export function applyNetworkSection(yamlText: string, network: NetworkSnapshot | null): string {
  if (network == null) return yamlText
  let doc: Record<string, unknown>
  try {
    const parsed = yaml.load(yamlText)
    doc = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>
  } catch {
    doc = {}
  }
  doc.network = structuredClone(network) as Record<string, unknown>
  return yaml.dump(doc, YAML_DUMP_OPTS)
}

/** Build a network: block YAML string suitable for appending to a manually-built config. */
export function buildNetworkYaml(rules: NetworkRule[]): string {
  if (rules.length === 0) return ""
  // Reverse for the same reason as injectNetworkRules (Ludus -I insert semantics)
  const block = { network: { rules: [...rules].reverse().map(ruleToPlain) } }
  return "\n" + yaml.dump(block, { indent: 2, lineWidth: -1, noRefs: true })
}

/**
 * Extract the unique VLAN numbers used in the `ludus:` VM list of a range-config YAML.
 * Returns a sorted array of numbers. Returns [] if the YAML is empty or unparseable.
 */
export function extractVlansFromConfig(yamlText: string): number[] {
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return []
    const ludus = doc.ludus
    if (!Array.isArray(ludus)) return []
    const vlans = new Set<number>()
    for (const vm of ludus) {
      if (vm && typeof vm === "object" && "vlan" in vm) {
        const n = Number((vm as Record<string, unknown>).vlan)
        if (!isNaN(n) && n > 0) vlans.add(n)
      }
    }
    return Array.from(vlans).sort((a, b) => a - b)
  } catch {
    return []
  }
}

/**
 * Strip VM entries belonging to a GOAD extension from the top-level `ludus:`
 * list of a range-config YAML. Matching is done case-insensitively against
 * each entry's `vm_name` / `hostname` using the extension's short slug
 * (the token before the first dot of `extensionName`).
 *
 * Called from the extension-removal flow so the user does NOT have to
 * hand-edit range-config.yml after uninstalling an extension — otherwise a
 * subsequent full deploy or `provide` re-creates the VMs from stale entries.
 *
 * Returns the original YAML unchanged when nothing matched or the YAML is
 * unparseable; returns the re-dumped YAML otherwise.
 */
export function removeExtensionVmsFromRangeConfig(
  yamlText: string,
  extensionName: string,
): { yaml: string; removed: string[] } {
  const out = { yaml: yamlText, removed: [] as string[] }
  const ext = extensionName.trim().toLowerCase()
  if (!ext) return out
  const extShort = ext.split(".")[0]
  let doc: Record<string, unknown>
  try {
    const parsed = yaml.load(yamlText)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out
    doc = parsed as Record<string, unknown>
  } catch {
    return out
  }
  const ludus = doc.ludus
  if (!Array.isArray(ludus)) return out
  const matches = (entry: unknown): string | null => {
    if (!entry || typeof entry !== "object") return null
    const e = entry as Record<string, unknown>
    for (const k of ["vm_name", "hostname"] as const) {
      const v = e[k]
      if (typeof v !== "string") continue
      const vl = v.toLowerCase()
      const vs = vl.split(".")[0]
      if (vl === ext || vs === ext || vl === extShort || vs === extShort) return v
      if (extShort.length >= 3 && vs.includes(extShort)) return v
    }
    return null
  }
  const kept: unknown[] = []
  for (const entry of ludus) {
    const hit = matches(entry)
    if (hit) out.removed.push(hit)
    else kept.push(entry)
  }
  if (out.removed.length === 0) return out
  doc.ludus = kept
  out.yaml = yaml.dump(doc, YAML_DUMP_OPTS)
  return out
}

/** True when `network.rules` is a non-empty array (explicit firewall rows). */
export function hasNetworkRules(snapshot: NetworkSnapshot | null): boolean {
  if (!snapshot) return false
  const rules = snapshot.rules
  return Array.isArray(rules) && rules.length > 0
}

/** True when the captured `network:` object has any keys beyond an empty stub (rules, VLANs, dns, etc.). */
export function networkSnapshotNeedsRedeploy(snapshot: NetworkSnapshot | null): boolean {
  if (!snapshot || typeof snapshot !== "object") return false
  if (hasNetworkRules(snapshot)) return true
  const keys = Object.keys(snapshot).filter((k) => !k.startsWith("_"))
  return keys.length > 0
}

/**
 * Return true when the `network:` section in the given YAML string is
 * semantically equal to the snapshot.  Uses yaml.dump with the same
 * normalisation options so formatting differences between Ludus's native
 * YAML and js-yaml's output don't produce false positives.
 */
export function networkSectionEqual(
  yamlText: string,
  snapshot: NetworkSnapshot,
): boolean {
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return false
    const network = doc.network
    if (!network || typeof network !== "object" || Array.isArray(network)) return false
    return (
      yaml.dump(network as Record<string, unknown>, YAML_DUMP_OPTS) ===
      yaml.dump(snapshot, YAML_DUMP_OPTS)
    )
  } catch {
    return false
  }
}

/** Return a blank NetworkRule with sensible defaults. */
export function blankRule(): NetworkRule {
  return {
    name: "",
    vlan_src: 10,
    vlan_dst: "wireguard",
    protocol: "all",
    ports: "all",
    action: "ACCEPT",
  }
}
