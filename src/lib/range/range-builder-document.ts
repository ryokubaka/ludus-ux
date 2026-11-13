import yaml from "js-yaml"
import {
  type NetworkRule,
  type VlanValue,
  type Protocol,
  type RuleAction,
  normalizeIpLastOctet,
  octetForYaml,
  portsForYaml,
  normalizePorts,
} from "@/lib/range/network-rules"
import {
  defaultsForTemplate,
  vmEntryToLudusObject,
  inferOS,
} from "@/lib/range/range-vm-wizard"
import {
  FOREST_TRUST_ROLE,
  CHILD_DOMAIN_ROLE,
  CHILD_DOMAIN_JOIN_ROLE,
  LUDUS_WINDOWS_UTILS_COLLECTION,
  findLudusRoleDef,
  isLudusRole,
} from "@/lib/range/range-builder-ludus-roles"

/**
 * Pure model behind the visual range builder.
 *
 * The document keeps the full parsed range-config object (unknown keys and
 * comments-as-values included). The canvas reads a typed projection and edits
 * through the mutation helpers; serialize re-emits the same YAML Ludus already
 * accepts from the New Range wizard and the Configuration page.
 */

const YAML_DUMP_OPTS = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  quotingType: '"' as const,
  forceQuotes: false,
}

const YAML_LOAD = (text: string): Record<string, unknown> => {
  try {
    const parsed = yaml.load(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export interface RangeDocument {
  /** Full parsed range-config object. Unknown keys are preserved. */
  root: Record<string, unknown>
}

export type OsKind = "windows" | "linux" | "macos" | "other"
export type DomainRole = "none" | "primary-dc" | "alt-dc" | "member"

export interface BuilderRoleEntry {
  name: string
  dependsOn: Array<{ vmName: string; role: string }>
}

export interface BuilderVm {
  /** Stable id — the Ludus `vm_name` (unique, template form kept). */
  id: string
  vmName: string
  hostname: string
  template: string
  vlan: number
  ipLastOctet: number
  ramGb: number
  cpus: number
  os: OsKind
  domainFqdn: string | null
  domainRole: DomainRole
  roles: BuilderRoleEntry[]
  roleVars: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface BuilderVlan {
  vlan: number
  vmIds: string[]
}

export interface BuilderDomain {
  fqdn: string
  vmIds: string[]
  primaryDcVmId: string | null
  /** Parent FQDN when this domain's DC runs `ludus_child_domain`. */
  childOfFqdn: string | null
}

export interface BuilderRouter {
  present: boolean
  vmName: string | null
  hostname: string | null
  template: string | null
  ramGb: number | null
  cpus: number | null
}

export interface BuilderTrust {
  /** VM (primary DC) that initiates the trust. */
  sourceVmId: string
  fromFqdn: string | null
  toFqdn: string
  sidHistory: boolean
}

export interface DependsEdge {
  fromVmId: string
  fromRole: string
  toVmName: string
  toRole: string
}

export interface NetworkDefaults {
  external_default?: "ACCEPT" | "REJECT" | "DROP"
  inter_vlan_default?: "ACCEPT" | "REJECT" | "DROP"
  wireguard_vlan_default?: "ACCEPT" | "REJECT" | "DROP"
  always_blocked_networks?: string[]
}

export interface BuilderGraph {
  vms: BuilderVm[]
  vlans: BuilderVlan[]
  domains: BuilderDomain[]
  router: BuilderRouter
  rules: NetworkRule[]
  networkDefaults: NetworkDefaults
  rangeDefaults: Record<string, unknown>
  trusts: BuilderTrust[]
  dependsOn: DependsEdge[]
}

// ── Parse / serialize ─────────────────────────────────────────────────────────

export function parseRangeDocument(yamlText: string): RangeDocument {
  return { root: YAML_LOAD(yamlText ?? "") }
}

export function cloneDocument(doc: RangeDocument): RangeDocument {
  return { root: structuredClone(doc.root) }
}

export function serializeRangeDocument(doc: RangeDocument): string {
  return yaml.dump(doc.root, YAML_DUMP_OPTS)
}

/** YAML the builder would write. Quoting and indentation are not an edit. */
export function canonicalRangeYaml(yamlText: string): string {
  return serializeRangeDocument(parseRangeDocument(yamlText))
}

// ── Low-level access ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function ludusList(root: Record<string, unknown>): Record<string, unknown>[] {
  const l = root.ludus
  if (!Array.isArray(l)) return []
  return l.filter((v): v is Record<string, unknown> => asRecord(v) != null)
}

function osOfRaw(vm: Record<string, unknown>): OsKind {
  if (vm.windows && typeof vm.windows === "object") return "windows"
  if (vm.macos === true || vm.macOS === true) return "macos"
  if (vm.linux === true || asRecord(vm.linux) != null) return "linux"
  const tpl = String(vm.template ?? vm.vm_name ?? "")
  const { isWindows, isLinux } = inferOS(tpl)
  if (isWindows) return "windows"
  if (isLinux) return "linux"
  return "other"
}

function normalizeVlan(v: unknown): VlanValue {
  if (v === "wireguard" || v === "public" || v === "all") return v
  const n = Number(v)
  return Number.isNaN(n) ? "all" : n
}

function normalizeProtocol(v: unknown): Protocol {
  if (v === "tcp" || v === "udp") return v
  return "all"
}

function domainFqdnOwnedBy(domains: Iterable<BuilderDomain>, vm: BuilderVm): string | null {
  const owned = [...domains].filter((d) => d.primaryDcVmId === vm.id)
  if (owned.length === 0) return null
  if (owned.length === 1) return owned[0].fqdn
  return (
    owned.find((d) => d.childOfFqdn)?.fqdn ??
    owned.find((d) => d.fqdn === vm.domainFqdn)?.fqdn ??
    owned[0].fqdn
  )
}

function normalizeAction(v: unknown): RuleAction {
  if (v === "REJECT" || v === "DROP") return v
  return "ACCEPT"
}

function rawRuleToNetworkRule(r: Record<string, unknown>): NetworkRule {
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

function parseRoleEntry(entry: unknown): BuilderRoleEntry | null {
  if (typeof entry === "string") {
    const name = entry.trim()
    return name ? { name, dependsOn: [] } : null
  }
  const rec = asRecord(entry)
  if (!rec || typeof rec.name !== "string") return null
  const dependsOn: BuilderRoleEntry["dependsOn"] = []
  if (Array.isArray(rec.depends_on)) {
    for (const dep of rec.depends_on) {
      const d = asRecord(dep)
      if (d && typeof d.vm_name === "string" && typeof d.role === "string") {
        dependsOn.push({ vmName: d.vm_name, role: d.role })
      }
    }
  }
  return { name: rec.name.trim(), dependsOn }
}

/**
 * Ludus testing flags on a VM.
 * A missing `testing` block blocks internet (the Ludus default) and does not snapshot.
 * `block_internet: false` is the exception that keeps internet while testing mode is on.
 */
export function vmTestingFlag(vm: BuilderVm, key: "snapshot" | "block_internet"): boolean {
  const block = vm.raw.testing
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return key === "block_internet"
  }
  const value = (block as Record<string, unknown>)[key]
  if (key === "block_internet") return value !== false
  return value === true
}

function buildVm(raw: Record<string, unknown>): BuilderVm {
  const domain = asRecord(raw.domain)
  const roles = Array.isArray(raw.roles)
    ? raw.roles.map(parseRoleEntry).filter((r): r is BuilderRoleEntry => r != null)
    : []
  return {
    id: String(raw.vm_name ?? raw.hostname ?? ""),
    vmName: String(raw.vm_name ?? ""),
    hostname: String(raw.hostname ?? ""),
    template: String(raw.template ?? ""),
    vlan: Number(raw.vlan) || 0,
    ipLastOctet: Number(raw.ip_last_octet) || 0,
    ramGb: Number(raw.ram_gb) || 0,
    cpus: Number(raw.cpus) || 0,
    os: osOfRaw(raw),
    domainFqdn: domain && typeof domain.fqdn === "string" ? domain.fqdn : null,
    domainRole: domain && typeof domain.role === "string" ? (domain.role as DomainRole) : "none",
    roles,
    roleVars: asRecord(raw.role_vars) ?? {},
    raw,
  }
}

/**
 * Domain a child-domain role places this host in. The GOAD blueprint omits
 * `domain:` and names the child only in role vars. This is display data —
 * saving still writes `domain:` only when the operator changes membership.
 */
export function childDomainFromRoles(
  vm: Pick<BuilderVm, "roles" | "roleVars">,
): { fqdn: string; role: "primary-dc" | "member" } | null {
  const promotes = vm.roles.some((role) => isLudusRole(role.name, CHILD_DOMAIN_ROLE))
  const joins = vm.roles.some((role) => isLudusRole(role.name, CHILD_DOMAIN_JOIN_ROLE))
  if (!promotes && !joins) return null
  const fqdn = String(vm.roleVars.ludus_child_domain_fqdn ?? "").trim()
  if (!fqdn) return null
  return promotes ? { fqdn, role: "primary-dc" } : { fqdn, role: "member" }
}

/**
 * GOAD joins a workstation with `commonwkstn` and a server with `member_server`.
 * The domain is `member_domain` on the VM, not a Ludus `domain:` block.
 * A Jinja value is left for the GOAD lab overlay to resolve.
 */
export function memberDomainFromRoles(
  vm: Pick<BuilderVm, "roles" | "roleVars">,
): { fqdn: string; role: "member" } | null {
  const joined = vm.roles.some((role) => {
    const name = role.name.trim().toLowerCase()
    return (
      name === "commonwkstn" ||
      name.endsWith(".commonwkstn") ||
      name === "member_server" ||
      name.endsWith(".member_server")
    )
  })
  if (!joined) return null
  const nested = asRecord(vm.roleVars.commonwkstn) ?? asRecord(vm.roleVars.member_server)
  const raw = String(vm.roleVars.member_domain ?? nested?.member_domain ?? "").trim()
  if (!raw || raw.includes("{")) return null
  return { fqdn: raw, role: "member" }
}

// ── Graph projection ──────────────────────────────────────────────────────────

export function projectGraph(doc: RangeDocument): BuilderGraph {
  const root = doc.root
  const rawVms = ludusList(root)
  const vms = rawVms.map(buildVm)
  for (const vm of vms) {
    if (vm.domainFqdn) continue
    const forced = childDomainFromRoles(vm) ?? memberDomainFromRoles(vm)
    if (!forced) continue
    vm.domainFqdn = forced.fqdn
    if (vm.domainRole === "none") vm.domainRole = forced.role
  }

  const vlanMap = new Map<number, string[]>()
  for (const vm of vms) {
    if (!vm.vlan) continue
    if (!vlanMap.has(vm.vlan)) vlanMap.set(vm.vlan, [])
    vlanMap.get(vm.vlan)!.push(vm.id)
  }
  const vlans: BuilderVlan[] = [...vlanMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vlan, vmIds]) => ({ vlan, vmIds }))

  const domainMap = new Map<string, BuilderDomain>()
  for (const vm of vms) {
    if (!vm.domainFqdn) continue
    let d = domainMap.get(vm.domainFqdn)
    if (!d) {
      d = { fqdn: vm.domainFqdn, vmIds: [], primaryDcVmId: null, childOfFqdn: null }
      domainMap.set(vm.domainFqdn, d)
    }
    d.vmIds.push(vm.id)
    if (vm.domainRole === "primary-dc" && !d.primaryDcVmId) d.primaryDcVmId = vm.id
  }

  // Child domains: a VM running ludus_child_domain defines a new domain whose
  // parent FQDN comes from its role vars. The child DC often is not a native
  // primary-dc, so register the domain from the role if missing.
  for (const vm of vms) {
    for (const role of vm.roles) {
      if (!isLudusRole(role.name, CHILD_DOMAIN_ROLE)) continue
      const childFqdn = String(vm.roleVars.ludus_child_domain_fqdn ?? "").trim()
      const parentFqdn = String(vm.roleVars.ludus_parent_domain_fqdn ?? "").trim() || null
      if (!childFqdn) continue
      let d = domainMap.get(childFqdn)
      if (!d) {
        d = { fqdn: childFqdn, vmIds: [], primaryDcVmId: null, childOfFqdn: null }
        domainMap.set(childFqdn, d)
      }
      if (!d.vmIds.includes(vm.id)) d.vmIds.push(vm.id)
      if (!d.primaryDcVmId) d.primaryDcVmId = vm.id
      d.childOfFqdn = parentFqdn
    }
  }

  const trusts: BuilderTrust[] = []
  for (const vm of vms) {
    for (const role of vm.roles) {
      if (!isLudusRole(role.name, FOREST_TRUST_ROLE)) continue
      const toFqdn = String(vm.roleVars.ludus_trust_partner_domain ?? "").trim()
      if (!toFqdn) continue
      trusts.push({
        sourceVmId: vm.id,
        fromFqdn: domainFqdnOwnedBy(domainMap.values(), vm),
        toFqdn,
        sidHistory: vm.roleVars.ludus_enable_sid_history === true,
      })
    }
  }

  const domains = [...domainMap.values()].sort((a, b) => a.fqdn.localeCompare(b.fqdn))

  const router = projectRouter(root)

  const network = asRecord(root.network)
  const fileRules = network && Array.isArray(network.rules) ? network.rules : []
  const rules = [...fileRules]
    .reverse()
    .filter((r): r is Record<string, unknown> => asRecord(r) != null)
    .map(rawRuleToNetworkRule)

  const networkDefaults: NetworkDefaults = {}
  if (network) {
    for (const k of ["external_default", "inter_vlan_default", "wireguard_vlan_default"] as const) {
      const v = network[k]
      if (v === "ACCEPT" || v === "REJECT" || v === "DROP") networkDefaults[k] = v
    }
    if (Array.isArray(network.always_blocked_networks)) {
      networkDefaults.always_blocked_networks = network.always_blocked_networks.map(String)
    }
  }

  const dependsOn: DependsEdge[] = []
  for (const vm of vms) {
    for (const role of vm.roles) {
      for (const dep of role.dependsOn) {
        dependsOn.push({
          fromVmId: vm.id,
          fromRole: role.name,
          toVmName: dep.vmName,
          toRole: dep.role,
        })
      }
    }
  }

  return {
    vms,
    vlans,
    domains,
    router,
    rules,
    networkDefaults,
    rangeDefaults: asRecord(root.defaults) ?? {},
    trusts,
    dependsOn,
  }
}

function projectRouter(root: Record<string, unknown>): BuilderRouter {
  const r = asRecord(root.router)
  if (!r) return { present: false, vmName: null, hostname: null, template: null, ramGb: null, cpus: null }
  return {
    present: true,
    vmName: typeof r.vm_name === "string" ? r.vm_name : null,
    hostname: typeof r.hostname === "string" ? r.hostname : null,
    template: typeof r.template === "string" ? r.template : null,
    ramGb: r.ram_gb != null ? Number(r.ram_gb) : null,
    cpus: r.cpus != null ? Number(r.cpus) : null,
  }
}

// ── Mutations (return a new document) ─────────────────────────────────────────

function withDoc(doc: RangeDocument, fn: (root: Record<string, unknown>) => void): RangeDocument {
  const next = cloneDocument(doc)
  fn(next.root)
  return next
}

function findVmRaw(root: Record<string, unknown>, vmId: string): Record<string, unknown> | null {
  const list = Array.isArray(root.ludus) ? root.ludus : []
  for (const item of list) {
    const rec = asRecord(item)
    if (rec && String(rec.vm_name ?? rec.hostname ?? "") === vmId) return rec
  }
  return null
}

export function usedOctets(doc: RangeDocument, vlan: number): Set<number> {
  const out = new Set<number>()
  for (const vm of ludusList(doc.root)) {
    if (Number(vm.vlan) === vlan) {
      const o = Number(vm.ip_last_octet)
      if (Number.isFinite(o)) out.add(o)
    }
  }
  return out
}

export function nextOctetForVlan(doc: RangeDocument, vlan: number, reserved?: Set<number>): number {
  const used = usedOctets(doc, vlan)
  for (let o = 10; o <= 254; o++) {
    if (!used.has(o) && !reserved?.has(o)) return o
  }
  return 254
}

export function existingVlans(doc: RangeDocument): number[] {
  const set = new Set<number>()
  for (const vm of ludusList(doc.root)) {
    const n = Number(vm.vlan)
    if (Number.isFinite(n) && n > 0) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

export function nextFreeVlan(doc: RangeDocument, alsoUsed: readonly number[] = []): number {
  const used = new Set(existingVlans(doc))
  for (const v of alsoUsed) used.add(v)
  for (let v = 10; v <= 255; v++) {
    if (!used.has(v)) return v
  }
  return 255
}

/** Build and append a Ludus VM object for a template drop. */
export function addVmFromTemplate(
  doc: RangeDocument,
  template: string,
  opts?: { vlan?: number; ipLastOctet?: number; domainFqdn?: string | null },
): { doc: RangeDocument; vmId: string } {
  const vlan = opts?.vlan ?? 10
  const octet = opts?.ipLastOctet ?? nextOctetForVlan(doc, vlan)
  const entry = defaultsForTemplate(template, { vlan, ipLastOctet: octet })
  // Keep a VM name unique when the default suffix collides with an existing VM.
  const obj = vmEntryToLudusObject(entry)
  let vmName = String(obj.vm_name ?? "")
  const existing = new Set(ludusList(doc.root).map((v) => String(v.vm_name ?? "")))
  if (existing.has(vmName)) {
    let n = 2
    const base = vmName
    while (existing.has(`${base}-${n}`)) n++
    vmName = `${base}-${n}`
    obj.vm_name = vmName
    if (typeof obj.hostname === "string") obj.hostname = `${obj.hostname}-${n}`.slice(0, 63)
  }
  let next = withDoc(doc, (root) => {
    const list = Array.isArray(root.ludus) ? [...root.ludus] : []
    list.push(obj)
    root.ludus = list
  })
  const domainFqdn = opts?.domainFqdn?.trim() ?? ""
  if (domainFqdn && entry.isWindows) {
    const hasPrimary = projectGraph(doc).domains.some(
      (d) => d.fqdn === domainFqdn && d.primaryDcVmId != null,
    )
    next = setDomainMembership(next, vmName, domainFqdn, hasPrimary ? "member" : "primary-dc")
  }
  return { doc: next, vmId: vmName }
}

export function removeVm(doc: RangeDocument, vmId: string): RangeDocument {
  return withDoc(doc, (root) => {
    if (!Array.isArray(root.ludus)) return
    root.ludus = root.ludus.filter((item) => {
      const rec = asRecord(item)
      return !(rec && String(rec.vm_name ?? rec.hostname ?? "") === vmId)
    })
  })
}

const DC_ADDRESS_ROLE_VARS = [
  "ludus_trust_partner_dc_ip",
  "ludus_dns_forward_server",
  "ludus_parent_dc_ip",
  "ludus_child_dc_ip",
] as const

function dcAddress(rangeNumber: number, vlan: number, octet: number): string {
  return `10.${rangeNumber}.${vlan}.${octet}`
}

function rewriteExactDcAddress(
  root: Record<string, unknown>,
  rangeNumber: number | null | undefined,
  oldVlan: number,
  oldOctet: number,
  newVlan: number,
  newOctet: number,
  exceptVmId?: string,
): void {
  if (rangeNumber == null || !Number.isFinite(rangeNumber)) return
  if (!Number.isFinite(oldVlan) || !Number.isFinite(oldOctet)) return
  if (!Number.isFinite(newVlan) || !Number.isFinite(newOctet)) return
  if (oldVlan === newVlan && oldOctet === newOctet) return
  const stillThere = ludusList(root).some((vm) => {
    const id = String(vm.vm_name ?? vm.hostname ?? "")
    if (exceptVmId != null && id === exceptVmId) return false
    return Number(vm.vlan) === oldVlan && Number(vm.ip_last_octet) === oldOctet
  })
  if (stillThere) return
  const oldIp = dcAddress(rangeNumber, oldVlan, oldOctet)
  const newIp = dcAddress(rangeNumber, newVlan, newOctet)
  for (const vm of ludusList(root)) {
    const rv = asRecord(vm.role_vars)
    if (!rv) continue
    for (const key of DC_ADDRESS_ROLE_VARS) {
      if (rv[key] === oldIp) rv[key] = newIp
    }
  }
}

function rewriteDependsOnVmName(root: Record<string, unknown>, from: string, to: string): void {
  if (!from || from === to) return
  for (const vm of ludusList(root)) {
    if (!Array.isArray(vm.roles)) continue
    for (const entry of vm.roles) {
      const rec = asRecord(entry)
      if (!rec || !Array.isArray(rec.depends_on)) continue
      for (const dep of rec.depends_on) {
        const item = asRecord(dep)
        if (item && item.vm_name === from) item.vm_name = to
      }
    }
  }
}

/** Shallow-merge raw VM fields. Pass `undefined` to delete a key. */
export function updateVmRaw(
  doc: RangeDocument,
  vmId: string,
  patch: Record<string, unknown>,
): RangeDocument {
  return withDoc(doc, (root) => {
    const vm = findVmRaw(root, vmId)
    if (!vm) return
    const previousName = typeof vm.vm_name === "string" ? vm.vm_name : ""
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete vm[k]
      else vm[k] = v
    }
    const nextName = vm.vm_name
    if (typeof nextName === "string" && previousName && nextName !== previousName) {
      rewriteDependsOnVmName(root, previousName, nextName)
    }
  })
}

export function moveVmToVlan(
  doc: RangeDocument,
  vmId: string,
  vlan: number,
  ipLastOctet?: number,
  rangeNumber?: number | null,
): RangeDocument {
  const reserved = usedOctets(doc, vlan)
  const current = ludusList(doc.root).find((v) => String(v.vm_name ?? v.hostname ?? "") === vmId)
  const oldVlan = Number(current?.vlan)
  const oldOctet = Number(current?.ip_last_octet)
  let octet = ipLastOctet
  if (octet == null) {
    octet = Number.isFinite(oldOctet) && !reserved.has(oldOctet) ? oldOctet : nextOctetForVlan(doc, vlan, reserved)
  }
  const next = updateVmRaw(doc, vmId, { vlan, ip_last_octet: octet })
  return withDoc(next, (root) => {
    rewriteExactDcAddress(root, rangeNumber, oldVlan, oldOctet, vlan, octet, vmId)
  })
}

export function renumberVlan(
  doc: RangeDocument,
  oldVlan: number,
  newVlan: number,
  rangeNumber?: number | null,
): RangeDocument {
  if (oldVlan === newVlan) return doc
  return withDoc(doc, (root) => {
    const movers = ludusList(root).filter((vm) => Number(vm.vlan) === oldVlan)
    for (const vm of movers) {
      const octet = Number(vm.ip_last_octet)
      const id = String(vm.vm_name ?? vm.hostname ?? "")
      rewriteExactDcAddress(root, rangeNumber, oldVlan, octet, newVlan, octet, id)
      vm.vlan = newVlan
    }
    const network = asRecord(root.network)
    if (network && Array.isArray(network.rules)) {
      for (const r of network.rules) {
        const rec = asRecord(r)
        if (!rec) continue
        if (Number(rec.vlan_src) === oldVlan) rec.vlan_src = newVlan
        if (Number(rec.vlan_dst) === oldVlan) rec.vlan_dst = newVlan
      }
    }
  })
}

export function setDomainMembership(
  doc: RangeDocument,
  vmId: string,
  fqdn: string | null,
  role: DomainRole,
): RangeDocument {
  return withDoc(doc, (root) => {
    const vm = findVmRaw(root, vmId)
    if (!vm) return
    if (!fqdn || role === "none") {
      delete vm.domain
      return
    }
    if (osOfRaw(vm) !== "windows") return
    vm.domain = { fqdn, role }
  })
}

/** Rename a domain FQDN everywhere: member VMs plus any trust role vars pointing at it. */
export function renameDomain(doc: RangeDocument, oldFqdn: string, newFqdn: string): RangeDocument {
  if (!newFqdn.trim() || oldFqdn === newFqdn) return doc
  return withDoc(doc, (root) => {
    for (const vm of ludusList(root)) {
      const domain = asRecord(vm.domain)
      if (domain && domain.fqdn === oldFqdn) domain.fqdn = newFqdn
      const rv = asRecord(vm.role_vars)
      if (!rv) continue
      for (const key of [
        "ludus_trust_partner_domain",
        "ludus_dns_forward_zone",
        "ludus_child_domain_fqdn",
        "ludus_parent_domain_fqdn",
      ]) {
        if (rv[key] === oldFqdn) rv[key] = newFqdn
      }
    }
  })
}

export function setRangeDefaults(
  doc: RangeDocument,
  patch: Record<string, unknown>,
): RangeDocument {
  return withDoc(doc, (root) => {
    const defaults = asRecord(root.defaults) ? { ...(root.defaults as Record<string, unknown>) } : {}
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") delete defaults[k]
      else defaults[k] = v
    }
    if (Object.keys(defaults).length === 0) delete root.defaults
    else root.defaults = defaults
  })
}

export function setRouter(doc: RangeDocument, patch: Record<string, unknown>): RangeDocument {
  return withDoc(doc, (root) => {
    const router = asRecord(root.router) ? { ...(root.router as Record<string, unknown>) } : {}
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "" || v === null) delete router[k]
      else router[k] = v
    }
    if (Object.keys(router).length === 0) delete root.router
    else root.router = router
  })
}

// ── Roles ─────────────────────────────────────────────────────────────────────

function roleEntriesToRaw(entries: BuilderRoleEntry[]): unknown[] {
  return entries.map((e) => {
    if (e.dependsOn.length === 0) return e.name
    return {
      name: e.name,
      depends_on: e.dependsOn.map((d) => ({ vm_name: d.vmName, role: d.role })),
    }
  })
}

const FOREST_TRUST_ROLE_VARS = [
  "ludus_trust_partner_domain",
  "ludus_trust_partner_dc_ip",
  "ludus_dns_forward_zone",
  "ludus_dns_forward_server",
  "ludus_enable_sid_history",
  "ludus_cross_domain_group_members",
] as const

function unsetRoleVars(doc: RangeDocument, vmId: string, keys: readonly string[]): RangeDocument {
  const patch: Record<string, unknown> = {}
  for (const key of keys) patch[key] = undefined
  return setVmRoleVars(doc, vmId, patch)
}

export function setVmRoles(doc: RangeDocument, vmId: string, entries: BuilderRoleEntry[]): RangeDocument {
  const previous = projectGraph(doc).vms.find((v) => v.id === vmId)?.roles ?? []
  let next = withDoc(doc, (root) => {
    const vm = findVmRaw(root, vmId)
    if (!vm) return
    if (entries.length === 0) delete vm.roles
    else vm.roles = roleEntriesToRaw(entries)
  })
  const had = (short: string) => previous.some((r) => isLudusRole(r.name, short))
  const has = (short: string) => entries.some((r) => isLudusRole(r.name, short))
  if (had(FOREST_TRUST_ROLE) && !has(FOREST_TRUST_ROLE)) {
    next = unsetRoleVars(next, vmId, FOREST_TRUST_ROLE_VARS)
  }
  if (had(CHILD_DOMAIN_ROLE) && !has(CHILD_DOMAIN_ROLE)) {
    next = unsetRoleVars(next, vmId, ["ludus_parent_dc_ip"])
  }
  if (had(CHILD_DOMAIN_JOIN_ROLE) && !has(CHILD_DOMAIN_JOIN_ROLE)) {
    next = unsetRoleVars(next, vmId, ["ludus_child_dc_ip"])
  }
  return next
}

export function setVmRoleVars(
  doc: RangeDocument,
  vmId: string,
  patch: Record<string, unknown>,
): RangeDocument {
  return withDoc(doc, (root) => {
    const vm = findVmRaw(root, vmId)
    if (!vm) return
    const rv = asRecord(vm.role_vars) ? { ...(vm.role_vars as Record<string, unknown>) } : {}
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete rv[k]
      else rv[k] = v
    }
    if (Object.keys(rv).length === 0) delete vm.role_vars
    else vm.role_vars = rv
  })
}

// ── Forest trust & child domain relationships ─────────────────────────────────

export interface TrustContext {
  /** Second octet of the range (10.N.vlan.octet). */
  rangeNumber: number | null
}

export type TrustResult =
  | { ok: true; doc: RangeDocument }
  | { ok: false; reason: string }

function ipForVm(vm: BuilderVm, rangeNumber: number | null): string | null {
  if (rangeNumber == null || !vm.vlan || !vm.ipLastOctet) return null
  return `10.${rangeNumber}.${vm.vlan}.${vm.ipLastOctet}`
}

function hasRole(vm: BuilderVm, short: string): boolean {
  return vm.roles.some((r) => isLudusRole(r.name, short))
}

/**
 * Create a forest trust from `fromFqdn` to `toFqdn`. The role and its role vars
 * land on the source domain's primary DC. One DC can initiate one trust because
 * role_vars is shared; if its partner slot is taken, this returns a reason.
 */
export function addForestTrust(
  doc: RangeDocument,
  fromFqdn: string,
  toFqdn: string,
  ctx: TrustContext,
): TrustResult {
  const graph = projectGraph(doc)
  const fromDomain = graph.domains.find((d) => d.fqdn === fromFqdn)
  const toDomain = graph.domains.find((d) => d.fqdn === toFqdn)
  if (!fromDomain?.primaryDcVmId) {
    return { ok: false, reason: `${fromFqdn} has no primary domain controller to host the trust role.` }
  }
  if (!toDomain?.primaryDcVmId) {
    return { ok: false, reason: `${toFqdn} has no primary domain controller to trust.` }
  }
  const sourceVm = graph.vms.find((v) => v.id === fromDomain.primaryDcVmId)
  const partnerVm = graph.vms.find((v) => v.id === toDomain.primaryDcVmId)
  if (!sourceVm || !partnerVm) return { ok: false, reason: "Domain controller VM not found." }

  const partnerIp = ipForVm(partnerVm, ctx.rangeNumber)
  if (!partnerIp) {
    return {
      ok: false,
      reason: `Cannot resolve ${toFqdn}'s DC IP — deploy the range once so the range number is known, then add the trust.`,
    }
  }

  const existingPartner = String(sourceVm.roleVars.ludus_trust_partner_domain ?? "").trim()
  if (hasRole(sourceVm, FOREST_TRUST_ROLE) && existingPartner && existingPartner !== toFqdn) {
    return {
      ok: false,
      reason: `${fromFqdn}'s DC already initiates a trust with ${existingPartner}. Add the second trust from ${toFqdn} instead.`,
    }
  }

  const roleFqcn = `${LUDUS_WINDOWS_UTILS_COLLECTION}.${FOREST_TRUST_ROLE}`
  let next = setVmRoleVars(doc, sourceVm.id, {
    ludus_trust_partner_domain: toFqdn,
    ludus_trust_partner_dc_ip: partnerIp,
    ludus_dns_forward_zone: toFqdn,
    ludus_dns_forward_server: partnerIp,
  })
  if (!hasRole(sourceVm, FOREST_TRUST_ROLE)) {
    const entries: BuilderRoleEntry[] = [...sourceVm.roles]
    const dependsOn: BuilderRoleEntry["dependsOn"] = []
    // If the partner domain is a child domain, wait for it to be promoted.
    if (toDomain.childOfFqdn && hasRole(partnerVm, CHILD_DOMAIN_ROLE)) {
      dependsOn.push({
        vmName: partnerVm.vmName,
        role: `${LUDUS_WINDOWS_UTILS_COLLECTION}.${CHILD_DOMAIN_ROLE}`,
      })
    }
    entries.push({ name: roleFqcn, dependsOn })
    next = setVmRoles(next, sourceVm.id, entries)
  }
  return { ok: true, doc: next }
}

export function removeForestTrust(doc: RangeDocument, sourceVmId: string): RangeDocument {
  const graph = projectGraph(doc)
  const vm = graph.vms.find((v) => v.id === sourceVmId)
  if (!vm) return doc
  const entries = vm.roles.filter((r) => !isLudusRole(r.name, FOREST_TRUST_ROLE))
  return unsetRoleVars(setVmRoles(doc, sourceVmId, entries), sourceVmId, FOREST_TRUST_ROLE_VARS)
}

// ── Network rules ─────────────────────────────────────────────────────────────

/** Write rules (evaluation order) back to root in Ludus file order (reversed for -I). */
export function setNetworkRules(doc: RangeDocument, rules: NetworkRule[]): RangeDocument {
  return withDoc(doc, (root) => {
    const network = asRecord(root.network) ? { ...(root.network as Record<string, unknown>) } : {}
    if (rules.length === 0) {
      delete network.rules
      if (Object.keys(network).length === 0) delete root.network
      else root.network = network
      return
    }
    network.rules = [...rules].reverse().map(ruleToPlain)
    root.network = network
  })
}

export function setNetworkDefaults(doc: RangeDocument, defaults: NetworkDefaults): RangeDocument {
  return withDoc(doc, (root) => {
    const network = asRecord(root.network) ? { ...(root.network as Record<string, unknown>) } : {}
    for (const k of ["external_default", "inter_vlan_default", "wireguard_vlan_default"] as const) {
      const v = defaults[k]
      if (v) network[k] = v
      else delete network[k]
    }
    if (defaults.always_blocked_networks && defaults.always_blocked_networks.length > 0) {
      network.always_blocked_networks = [...defaults.always_blocked_networks]
    } else {
      delete network.always_blocked_networks
    }
    if (Object.keys(network).length === 0) delete root.network
    else root.network = network
  })
}

// ── Validation ────────────────────────────────────────────────────────────────

export type FindingLevel = "error" | "warning"

export interface Finding {
  level: FindingLevel
  message: string
  /** Node id this finding attaches to (vm id, `vlan:<n>`, `domain:<fqdn>`), when applicable. */
  nodeId?: string
}

const RANGE_ID_TEMPLATE = /\{\{\s*range_id\s*\}\}/g

/** Visible hostname length after dropping the `{{ range_id }}-` prefix. */
function visibleHostnameLength(hostname: string): number {
  return hostname.replace(RANGE_ID_TEMPLATE, "").replace(/^-+/, "").length
}

export function validateGraph(
  graph: BuilderGraph,
  builtTemplates?: Set<string>,
  rangeNumber?: number | null,
): Finding[] {
  const findings: Finding[] = []

  const vmNames = new Map<string, number>()
  for (const vm of graph.vms) {
    vmNames.set(vm.vmName, (vmNames.get(vm.vmName) ?? 0) + 1)
  }

  for (const vm of graph.vms) {
    if (!vm.vmName) findings.push({ level: "error", message: "VM is missing vm_name.", nodeId: vm.id })
    if ((vmNames.get(vm.vmName) ?? 0) > 1) {
      findings.push({ level: "error", message: `Duplicate vm_name "${vm.vmName}".`, nodeId: vm.id })
    }
    if (!vm.template) findings.push({ level: "error", message: "VM has no template.", nodeId: vm.id })
    else if (builtTemplates && builtTemplates.size > 0 && !builtTemplates.has(vm.template)) {
      findings.push({ level: "error", message: `Template "${vm.template}" is not built.`, nodeId: vm.id })
    }
    if (vm.vlan < 2 || vm.vlan > 255) {
      findings.push({ level: "error", message: `VLAN ${vm.vlan} is outside 2–255.`, nodeId: vm.id })
    }
    if (vm.ipLastOctet < 1 || vm.ipLastOctet > 254) {
      findings.push({ level: "error", message: `IP last octet ${vm.ipLastOctet} is outside 1–254.`, nodeId: vm.id })
    }
    if (vm.os === "windows" && visibleHostnameLength(vm.hostname) > 15) {
      findings.push({
        level: "warning",
        message: "Windows hostname is longer than 15 characters (NetBIOS limit).",
        nodeId: vm.id,
      })
    }
  }

  // Unique octet per VLAN.
  for (const vlan of graph.vlans) {
    const octets = new Map<number, string[]>()
    for (const id of vlan.vmIds) {
      const vm = graph.vms.find((v) => v.id === id)
      if (!vm) continue
      if (!octets.has(vm.ipLastOctet)) octets.set(vm.ipLastOctet, [])
      octets.get(vm.ipLastOctet)!.push(vm.id)
    }
    for (const [octet, ids] of octets) {
      if (ids.length > 1) {
        for (const id of ids) {
          findings.push({
            level: "error",
            message: `IP last octet ${octet} is used by more than one VM on VLAN ${vlan.vlan}.`,
            nodeId: id,
          })
        }
      }
    }
  }

  // Domains: at most one native primary DC, child domain wiring, trust vars.
  for (const domain of graph.domains) {
    const nodeId = `domain:${domain.fqdn}`
    const primaries = graph.vms.filter(
      (v) => v.domainFqdn === domain.fqdn && v.domainRole === "primary-dc",
    )
    if (primaries.length > 1) {
      findings.push({
        level: "error",
        message: `${domain.fqdn} has ${primaries.length} primary domain controllers (only one allowed).`,
        nodeId,
      })
    }
    if (domain.childOfFqdn) {
      const parent = graph.domains.find((d) => d.fqdn === domain.childOfFqdn)
      if (!parent?.primaryDcVmId) {
        findings.push({
          level: "error",
          message: `Child domain ${domain.fqdn} needs its parent ${domain.childOfFqdn} to have a primary DC.`,
          nodeId,
        })
      }
      const dc = graph.vms.find((v) => v.id === domain.primaryDcVmId)
      if (dc) {
        for (const key of ["ludus_child_domain_fqdn", "ludus_parent_domain_fqdn", "ludus_parent_dc_ip"]) {
          if (!String(dc.roleVars[key] ?? "").trim()) {
            findings.push({
              level: "error",
              message: `Child domain role on ${dc.vmName} is missing ${key}.`,
              nodeId: dc.id,
            })
          }
        }
      }
    }
  }

  for (const trust of graph.trusts) {
    const vm = graph.vms.find((v) => v.id === trust.sourceVmId)
    if (!vm) continue
    for (const key of [
      "ludus_trust_partner_domain",
      "ludus_trust_partner_dc_ip",
      "ludus_dns_forward_zone",
      "ludus_dns_forward_server",
    ]) {
      if (!String(vm.roleVars[key] ?? "").trim()) {
        findings.push({
          level: "error",
          message: `Forest trust on ${vm.vmName} is missing ${key}.`,
          nodeId: vm.id,
        })
      }
    }
  }

  flagStaleDcAddresses(findings, graph, rangeNumber)

  return findings
}

const DC_ADDRESS_REFERENCES = [
  { ip: "ludus_trust_partner_dc_ip", domain: "ludus_trust_partner_domain" },
  { ip: "ludus_dns_forward_server", domain: "ludus_dns_forward_zone", fallbackDomain: "ludus_trust_partner_domain" },
  { ip: "ludus_parent_dc_ip", domain: "ludus_parent_domain_fqdn" },
  { ip: "ludus_child_dc_ip", domain: "ludus_child_domain_fqdn" },
] as const

function domainPrimaryVm(graph: BuilderGraph, fqdn: string): BuilderVm | null {
  const domain = graph.domains.find((d) => d.fqdn === fqdn)
  if (!domain?.primaryDcVmId) return null
  return graph.vms.find((v) => v.id === domain.primaryDcVmId) ?? null
}

function flagStaleDcAddresses(
  findings: Finding[],
  graph: BuilderGraph,
  rangeNumber: number | null | undefined,
): void {
  for (const vm of graph.vms) {
    const present = DC_ADDRESS_REFERENCES.filter((ref) => String(vm.roleVars[ref.ip] ?? "").trim())
    if (present.length === 0) continue
    if (rangeNumber == null || !Number.isFinite(rangeNumber)) {
      findings.push({
        level: "warning",
        message: `Trust or child-domain DC address on ${vm.vmName} cannot be verified without a range number.`,
        nodeId: vm.id,
      })
      continue
    }
    for (const ref of present) {
      const stored = String(vm.roleVars[ref.ip]).trim()
      const resolved = stored.replace(/\{\{\s*range_second_octet\s*\}\}/gi, String(rangeNumber))
      const fqdn =
        String(vm.roleVars[ref.domain] ?? "").trim() ||
        ("fallbackDomain" in ref ? String(vm.roleVars[ref.fallbackDomain] ?? "").trim() : "")
      const referenced = fqdn ? domainPrimaryVm(graph, fqdn) : null
      const expected = referenced ? ipForVm(referenced, rangeNumber) : null
      const matchesReferenced = expected != null && resolved === expected
      const matchesAnyVm =
        !fqdn &&
        graph.vms.some((candidate) => ipForVm(candidate, rangeNumber) === resolved)
      if (matchesReferenced || matchesAnyVm) continue
      findings.push({
        level: "error",
        message: expected
          ? `${ref.ip} on ${vm.vmName} is ${stored}; ${fqdn}'s domain controller is ${expected}.`
          : `${ref.ip} on ${vm.vmName} does not match a domain controller in this range.`,
        nodeId: vm.id,
      })
    }
  }
}

export function hasBlockingFindings(findings: Finding[]): boolean {
  return findings.some((f) => f.level === "error")
}

/** True when the document references any Ansible role (deploy needs user-defined-roles tag). */
export function documentHasRoles(doc: RangeDocument): boolean {
  return ludusList(doc.root).some((vm) => Array.isArray(vm.roles) && vm.roles.length > 0)
}

export { findLudusRoleDef, roleShortName } from "@/lib/range/range-builder-ludus-roles"
export { CHILD_DOMAIN_JOIN_ROLE }
