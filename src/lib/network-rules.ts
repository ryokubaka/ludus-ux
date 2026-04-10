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

function rawToRule(r: Record<string, unknown>): NetworkRule {
  const rule: NetworkRule = {
    name: String(r.name ?? ""),
    vlan_src: normalizeVlan(r.vlan_src),
    vlan_dst: normalizeVlan(r.vlan_dst),
    protocol: normalizeProtocol(r.protocol),
    ports: r.ports != null ? String(r.ports) : "all",
    action: normalizeAction(r.action),
  }
  if (r.ip_last_octet_src != null) rule.ip_last_octet_src = String(r.ip_last_octet_src)
  if (r.ip_last_octet_dst != null) rule.ip_last_octet_dst = String(r.ip_last_octet_dst)
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
    ports: rule.protocol === "all" ? "all" : rule.ports,
    action: rule.action,
  }
  if (rule.ip_last_octet_src) obj.ip_last_octet_src = rule.ip_last_octet_src
  if (rule.ip_last_octet_dst) obj.ip_last_octet_dst = rule.ip_last_octet_dst
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

  return yaml.dump(doc, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  })
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
