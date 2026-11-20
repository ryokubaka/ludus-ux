import yaml from "js-yaml"
import { injectNetworkRules, type NetworkRule, type VlanValue } from "@/lib/range/network-rules"

/** Roles a from-scratch Ludus range can place on the first form. `os` limits which templates fit. */
export const RANGE_VM_ROLES = [
  { id: "primary-dc", label: "Primary domain controller", os: "windows" },
  { id: "alt-dc", label: "Alternate domain controller", os: "windows" },
  { id: "member", label: "Domain member server", os: "windows" },
  { id: "workstation", label: "Workstation", os: "windows" },
  { id: "router", label: "Linux router", os: "linux" },
] as const

export interface RangeVmDraft {
  hostname: string
  role: string
  template: string
  vlan: string
  /** FQDN for a primary domain controller, or the domain a joined VM belongs to. */
  domain?: string
  /** Set only for a workstation the person chose to join. Other roles ignore it. */
  domainJoin?: boolean
}

export interface RangeNetworkDraft {
  vlan: string
}

export interface RangeRuleDraft {
  name: string
  vlanSrc: string
  vlanDst: string
  protocol: string
  ports: string
  action: string
  ipLastOctetSrc?: string
  ipLastOctetDst?: string
}

export interface RangeTemplateChoice {
  id: string
  os: string
}

const RANGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const DOMAIN = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/

const HOST_BY_ROLE: Record<string, string[]> = {
  "primary-dc": ["dc01"],
  "alt-dc": ["dc02", "dc03"],
  member: ["srv01", "srv02", "srv03", "srv04"],
  workstation: ["ws01", "ws02", "ws03"],
  router: ["router"],
}

export function roleOs(role: string): string {
  return RANGE_VM_ROLES.find((item) => item.id === role)?.os ?? ""
}

function isWindowsTemplate(item: RangeTemplateChoice): boolean {
  if (item.os === "linux" || item.os === "macos") return false
  if (item.os === "windows") return true
  return /win/i.test(item.id)
}

function isServerTemplate(item: RangeTemplateChoice): boolean {
  return /server/i.test(item.id)
}

export function templatesForRole(role: string, templates: RangeTemplateChoice[]): RangeTemplateChoice[] {
  if (role === "primary-dc" || role === "alt-dc" || role === "member") {
    return templates.filter((item) => isWindowsTemplate(item) && isServerTemplate(item))
  }
  if (role === "workstation") {
    return templates.filter((item) => isWindowsTemplate(item) && !isServerTemplate(item))
  }
  if (role === "router") {
    return templates.filter((item) => item.os === "linux" || (item.os !== "windows" && item.os !== "macos" && !isWindowsTemplate(item)))
  }
  return []
}

export function defaultNetworks(): RangeNetworkDraft[] {
  return [{ vlan: "10" }]
}

export function defaultVmRows(templates: RangeTemplateChoice[], vlan = "10"): RangeVmDraft[] {
  const role = "primary-dc"
  return [{ hostname: "dc01", role, template: templatesForRole(role, templates)[0]?.id ?? "", vlan }]
}

export function nextVmRow(rows: RangeVmDraft[], templates: RangeTemplateChoice[], vlan = "10"): RangeVmDraft {
  const used = new Set(rows.map((row) => row.hostname.trim().toLowerCase()))
  const hasPrimary = rows.some((row) => row.role === "primary-dc")
  const role = hasPrimary ? "member" : "primary-dc"
  const names = HOST_BY_ROLE[role] ?? ["vm01"]
  const hostname = names.find((name) => !used.has(name)) ?? `${role.replace(/[^a-z]/g, "")}${rows.length + 1}`
  return { hostname, role, template: templatesForRole(role, templates)[0]?.id ?? "", vlan: vlan || rows[0]?.vlan || "10" }
}

export function nextRule(networks: RangeNetworkDraft[]): RangeRuleDraft {
  return {
    name: "",
    vlanSrc: networks[0]?.vlan || "10",
    vlanDst: "wireguard",
    protocol: "all",
    ports: "all",
    action: "ACCEPT",
  }
}

export function validateRangeId(value: string): string {
  const id = value.trim()
  if (!id) return "Range id is required."
  if (!RANGE_ID.test(id)) return "Range id must start with a letter or number and use only letters, numbers, hyphens, and underscores."
  return ""
}

export function validateRangeName(value: string): string {
  const name = value.trim()
  if (!name) return "Range name is required."
  if (name.length > 80) return "Range name must be 80 characters or fewer."
  return ""
}

export function validateVlan(value: string): string {
  const vlan = Number(value.trim())
  if (!Number.isInteger(vlan) || vlan < 2 || vlan > 255) return "VLAN must be a whole number from 2 to 255."
  return ""
}

/** A workstation stays off the domain until the person joins it. A domain member server does not. */
export function joinsDomain(row: RangeVmDraft): boolean {
  if (row.role === "workstation") return row.domainJoin === true
  return row.role === "primary-dc" || row.role === "alt-dc" || row.role === "member"
}

function primaryRows(rows: RangeVmDraft[]): RangeVmDraft[] {
  return rows.filter((row) => row.role === "primary-dc")
}

/** The domain this VM belongs to. One primary can still use the shared name. */
export function domainName(row: RangeVmDraft, rows: RangeVmDraft[], shared: string): string {
  const own = row.domain?.trim() || ""
  if (own) return own
  const primaries = primaryRows(rows)
  if (row.role === "primary-dc") return primaries.length === 1 ? shared.trim() : ""
  if (primaries.length === 1) return (primaries[0]?.domain?.trim() || shared).trim()
  return ""
}

export function validateDomain(value: string, rows: RangeVmDraft[]): string {
  const primaries = primaryRows(rows)
  if (primaries.length === 0) {
    const domain = value.trim()
    if (!rows.some(joinsDomain) && !domain) return ""
    if (!domain) return "Domain FQDN is required when a VM joins a domain."
    if (!DOMAIN.test(domain)) return "Domain must be a name like meow.local."
    return ""
  }
  const names = primaries.map((row) => domainName(row, rows, value))
  for (const name of names) {
    if (!name) return "Each primary domain controller needs a domain name."
    if (!DOMAIN.test(name)) return "Domain must be a name like meow.local."
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    return "Each primary domain controller needs its own domain name."
  }
  if (primaries.length < 2) return ""
  for (const row of rows) {
    if (row.role === "primary-dc" || !joinsDomain(row)) continue
    const picked = row.domain?.trim() || ""
    if (!names.some((name) => name.toLowerCase() === picked.toLowerCase())) {
      return `Choose a domain for ${row.hostname.trim() || "each joined VM"}.`
    }
  }
  return ""
}

function ruleOpensVlanPath(rule: RangeRuleDraft, src: string, dst: string): boolean {
  if (rule.action !== "ACCEPT" || rule.protocol !== "all") return false
  if (rule.ipLastOctetSrc?.trim() || rule.ipLastOctetDst?.trim()) return false
  const from = rule.vlanSrc.trim()
  const to = rule.vlanDst.trim()
  return (from === src || from === "all") && (to === dst || to === "all")
}

/**
 * A joined VM on another VLAN than the domain controller needs that path.
 * The warning names the fix and says the join may fail. It does not block Continue.
 */
export function domainJoinWarnings(rows: RangeVmDraft[], rules: RangeRuleDraft[]): string[] {
  const primaries = primaryRows(rows)
  if (primaries.length === 0) return []
  const warnings: string[] = []
  for (const row of rows) {
    if (row.role === "primary-dc" || !joinsDomain(row)) continue
    const wanted = row.domain?.trim().toLowerCase() || ""
    if (primaries.length > 1 && !wanted) continue
    const dc = primaries.length === 1
      ? primaries[0]
      : primaries.find((item) => (item.domain?.trim().toLowerCase() || "") === wanted) ?? primaries[0]
    if (!dc) continue
    const dcVlan = dc.vlan.trim()
    const vlan = row.vlan.trim()
    if (!vlan || vlan === dcVlan) continue
    const host = row.hostname.trim() || "This VM"
    const open = rules.some((rule) => ruleOpensVlanPath(rule, vlan, dcVlan))
      && rules.some((rule) => ruleOpensVlanPath(rule, dcVlan, vlan))
    if (open) continue
    const path = rules.length === 0
      ? "No rule allows that path. If inter-VLAN traffic is rejected, the join fails."
      : "These rules do not allow that path. If inter-VLAN traffic is rejected, the join fails."
    warnings.push(
      `${host} is on VLAN ${vlan} and ${dc.hostname.trim() || "the domain controller"} is on VLAN ${dcVlan}. Joining the domain needs traffic both ways. ${path} Add an allow rule in each direction, move ${host} to VLAN ${dcVlan}, or leave ${host} off the domain. Otherwise the join may fail.`,
    )
  }
  return warnings
}

export function validateNetworks(rows: RangeNetworkDraft[]): string {
  if (rows.length === 0) return "Add at least one network."
  const seen = new Set<string>()
  for (const row of rows) {
    const message = validateVlan(row.vlan)
    if (message) return message
    if (seen.has(row.vlan.trim())) return `VLAN ${row.vlan.trim()} is listed more than once.`
    seen.add(row.vlan.trim())
  }
  return ""
}

const RULE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const PORT_ITEM = String.raw`\d{1,5}(?:[:\-]\d{1,5})?`
const PORTS = new RegExp(`^(?:all|${PORT_ITEM})(?:,(?:all|${PORT_ITEM}))*$`)
const RULE_ENDS = new Set(["all", "public", "wireguard"])
const OCTET = /^\d{1,3}(?:-\d{1,3})?$/

export function validateRules(rows: RangeRuleDraft[], networks?: RangeNetworkDraft[]): string {
  const known = new Set((networks ?? []).map((row) => row.vlan.trim()))
  const names = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (!RULE_NAME.test(name)) return "Each firewall rule needs a name that starts with a letter."
    if (names.has(name.toLowerCase())) return `Firewall rule ${name} is listed more than once.`
    names.add(name.toLowerCase())
    for (const end of [row.vlanSrc, row.vlanDst]) {
      const value = end.trim()
      if (RULE_ENDS.has(value)) continue
      if (validateVlan(value)) return `Firewall rule ${name} must use a VLAN number, all, public, or wireguard.`
      if (networks && !known.has(value)) return `Firewall rule ${name} uses VLAN ${value}, which is not one of the networks.`
    }
    if (row.protocol !== "tcp" && row.protocol !== "udp" && row.protocol !== "all") return `Firewall rule ${name} needs a protocol.`
    if (row.action !== "ACCEPT" && row.action !== "REJECT" && row.action !== "DROP") return `Firewall rule ${name} needs an action.`
    const ports = row.ports.trim()
    if (row.protocol === "all") {
      if (ports && ports !== "all") return `Firewall rule ${name} uses every port when the protocol is all.`
    } else if (!PORTS.test(ports)) {
      return `Firewall rule ${name} needs ports such as all, 443, or 8080:8088.`
    }
    for (const octet of [row.ipLastOctetSrc, row.ipLastOctetDst]) {
      const value = octet?.trim()
      if (value && !OCTET.test(value)) return `Firewall rule ${name} last octet must be a number or a range such as 21-25.`
    }
  }
  return ""
}

export function validateRangeVms(rows: RangeVmDraft[], templates: RangeTemplateChoice[], networks?: RangeNetworkDraft[]): string {
  if (rows.length === 0) return "Add at least one VM."
  const known = new Set((networks ?? []).map((row) => row.vlan.trim()))
  const seen = new Set<string>()
  for (const row of rows) {
    const os = roleOs(row.role)
    if (!os) return "Pick a VM role."
    const hostname = row.hostname.trim()
    const hostPattern = os === "windows" ? /^[A-Za-z][A-Za-z0-9-]{0,14}$/ : /^[A-Za-z][A-Za-z0-9-]{0,62}$/
    if (!hostPattern.test(hostname) || hostname.endsWith("-")) {
      return os === "windows"
        ? "A Windows hostname is 1 to 15 letters, numbers, or hyphens, and starts with a letter."
        : "A Linux hostname is 1 to 63 letters, numbers, or hyphens, and starts with a letter."
    }
    const key = hostname.toLowerCase()
    if (seen.has(key)) return `Hostname ${hostname} is used more than once.`
    seen.add(key)
    if (networks && !known.has(row.vlan.trim())) return `${hostname} must use one of the networks.`
    const allowed = new Set(templatesForRole(row.role, templates).map((item) => item.id))
    if (!row.template || !allowed.has(row.template)) {
      if (row.role === "primary-dc" || row.role === "alt-dc" || row.role === "member") {
        return `Pick a Windows Server template for ${hostname}.`
      }
      if (row.role === "workstation") return `Pick a Windows workstation template for ${hostname}.`
      return `Pick a built ${os} template for ${hostname}.`
    }
  }
  return ""
}

export function parseRangeVms(raw: string): RangeVmDraft[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as { hostname?: unknown; role?: unknown; template?: unknown }
      const hostname = typeof row.hostname === "string" ? row.hostname.trim() : ""
      const role = typeof row.role === "string" ? row.role.trim() : ""
      const template = typeof row.template === "string" ? row.template.trim() : ""
      const vlan = typeof (row as { vlan?: unknown }).vlan === "string" ? (row as { vlan: string }).vlan.trim() : "10"
      if (!hostname && !role && !template) return []
      const domainJoin = (row as { domainJoin?: unknown }).domainJoin === true
      const domain = typeof (row as { domain?: unknown }).domain === "string" ? (row as { domain: string }).domain.trim() : ""
      return [{
        hostname,
        role,
        template,
        vlan: vlan || "10",
        ...(domain ? { domain } : {}),
        ...(domainJoin ? { domainJoin: true } : {}),
      }]
    })
  } catch {
    return []
  }
}

export function parseRangeNetworks(raw: string): RangeNetworkDraft[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const vlan = typeof (item as { vlan?: unknown }).vlan === "string" ? (item as { vlan: string }).vlan.trim() : ""
      return vlan ? [{ vlan }] : []
    })
  } catch {
    return []
  }
}

export function parseRangeRules(raw: string): RangeRuleDraft[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as Record<string, unknown>
      const text = (key: string) => typeof row[key] === "string" ? row[key].trim() : ""
      return [{
        name: text("name"),
        vlanSrc: text("vlanSrc") || "10",
        vlanDst: text("vlanDst") || "wireguard",
        protocol: text("protocol") || "all",
        ports: text("ports") || "all",
        action: text("action") || "ACCEPT",
        ipLastOctetSrc: text("ipLastOctetSrc") || undefined,
        ipLastOctetDst: text("ipLastOctetDst") || undefined,
      }]
    })
  } catch {
    return []
  }
}

export function describeRangePlan(rows: RangeVmDraft[], networks: RangeNetworkDraft[], rules: RangeRuleDraft[], domain: string): string {
  const lines = rows.map((row) => {
    const label = RANGE_VM_ROLES.find((item) => item.id === row.role)?.label ?? row.role
    const membership = row.role === "workstation"
      ? (row.domainJoin ? "joined the domain" : "not domain joined")
      : joinsDomain(row) ? "joined the domain" : "not domain joined"
    return `- ${row.hostname} on VLAN ${row.vlan}: ${label}, ${membership}, template ${row.template}`
  })
  const ruleLines = rules.length > 0
    ? rules.map((rule) => {
        const srcOctet = rule.ipLastOctetSrc ? `.${rule.ipLastOctetSrc}` : ""
        const dstOctet = rule.ipLastOctetDst ? `.${rule.ipLastOctetDst}` : ""
        const ports = rule.protocol === "all" ? "all" : rule.ports
        return `- ${rule.name}: ${rule.vlanSrc}${srcOctet} to ${rule.vlanDst}${dstOctet}, ${rule.protocol} ${ports}, ${rule.action}`
      })
    : ["- none"]
  const names = [...new Set(rows.filter((row) => row.role === "primary-dc").map((row) => domainName(row, rows, domain)).filter(Boolean))]
  const domainLine = names.length > 1
    ? `Domains: ${names.join(", ")}.`
    : names[0]
      ? `Domain ${names[0]}.`
      : domain.trim()
        ? `Domain ${domain.trim()}.`
        : "No domain."
  return [
    `Networks: ${networks.map((row) => `VLAN ${row.vlan}`).join(", ") || "none"}.`,
    domainLine,
    ...lines,
    "Firewall rules:",
    ...ruleLines,
  ].join("\n")
}

function ludusDomainRole(row: RangeVmDraft): string | null {
  if (row.role === "primary-dc" || row.role === "alt-dc" || row.role === "member") return row.role
  if (row.role === "workstation" && row.domainJoin) return "member"
  return null
}

function vlanForRule(value: string): VlanValue {
  const raw = value.trim()
  if (raw === "wireguard" || raw === "public" || raw === "all") return raw
  return Number(raw)
}

/** Ludus ports are start:end. A hyphen is the octet-range form, not a port range. */
function portsForRule(protocol: string, ports: string): string {
  if (protocol === "all") return "all"
  const value = ports.trim() || "all"
  if (value === "all") return "all"
  return value.replace(/(\d+)\s*-\s*(\d+)/g, "$1:$2")
}

function rulesForLudus(rules: RangeRuleDraft[]): NetworkRule[] {
  return rules.map((rule) => {
    const protocol = (rule.protocol.trim() || "all") as NetworkRule["protocol"]
    return {
      name: rule.name.trim(),
      vlan_src: vlanForRule(rule.vlanSrc),
      vlan_dst: vlanForRule(rule.vlanDst),
      protocol,
      ports: portsForRule(protocol, rule.ports),
      action: (rule.action.trim() || "ACCEPT") as NetworkRule["action"],
      ...(rule.ipLastOctetSrc?.trim() ? { ip_last_octet_src: rule.ipLastOctetSrc.trim() } : {}),
      ...(rule.ipLastOctetDst?.trim() ? { ip_last_octet_dst: rule.ipLastOctetDst.trim() } : {}),
    }
  })
}

/** Range config for a from-scratch build. The form already has the answers, so the model does not write this. */
export function scratchRangeYaml(rows: RangeVmDraft[], rules: RangeRuleDraft[], sharedDomain: string): string {
  const nextOctet = new Map<string, number>()
  const ludus = rows.map((row) => {
    const vlan = row.vlan.trim() || "10"
    const octet = (nextOctet.get(vlan) ?? 9) + 1
    nextOctet.set(vlan, octet)
    const role = ludusDomainRole(row)
    const fqdn = role ? domainName(row, rows, sharedDomain) : ""
    const vm: Record<string, unknown> = {
      vm_name: `{{ range_id }}-${row.hostname.trim()}`,
      hostname: `{{ range_id }}-${row.hostname.trim()}`,
      template: row.template.trim(),
      vlan: Number(vlan) || vlan,
      ip_last_octet: octet,
      ram_gb: row.role === "router" ? 2 : 4,
      cpus: 2,
    }
    if (row.role === "router") vm.linux = true
    else vm.windows = { sysprep: false }
    if (role && fqdn) vm.domain = { fqdn, role }
    return vm
  })
  const base = yaml.dump({ ludus }, { indent: 2, lineWidth: -1, noRefs: true }).trim()
  if (rules.length === 0) return base
  // injectNetworkRules writes integers for VLAN numbers and single octets, and reverses
  // the list because Ludus inserts each rule at the top.
  return injectNetworkRules(base, rulesForLudus(rules)).trim()
}
