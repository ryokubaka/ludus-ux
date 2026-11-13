import type { BuilderGraph, BuilderTrust, DomainRole } from "@/lib/range/range-builder-document"

/** Host row extracted from GOAD `data/config.json` without secrets. */
export interface GoadRawHost {
  key: string
  hostname: string
  type: string
  domain: string
  /** Last octet from the extension or lab inventory. The Ludus VM name is not required. */
  ipLastOctet?: number
}

/** A play in an extension `ansible/install.yml` that joins a host with `member_domain`. */
export interface GoadJoinHint {
  hosts: string
  memberDomain: string
  role: string
}

/** One VM from an extension `providers/ludus/config.yml`, not yet in range-config. */
export interface GoadPlannedVm {
  extension: string
  vmName: string
  hostname: string
  template: string
  vlan: number
  ipLastOctet: number
  ramGb: number
  cpus: number
}

/** Domain row extracted from GOAD `lab.domains` without passwords. */
export interface GoadRawDomain {
  fqdn: string
  dc: string
  trust: string
  /** Set when a play creates this domain under another, and the name is not a DNS child. */
  parent?: string
}

/** One play that joins a host or creates a domain. Extracted from a GOAD playbook. */
export interface GoadPlay {
  extension: string
  hosts: string[]
  roles: string[]
  memberDomain: string
  domain: string
  parentDomain: string
  domainName: string
}

/** Inventory host with the groups that name it and the address GOAD gives it. */
export interface GoadInventoryHost {
  extension: string
  host: string
  octet: number
  groups: string[]
}

/** An inventory group, including `:children` groups. */
export interface GoadInventoryGroup {
  extension: string
  name: string
  hosts: string[]
  children: string[]
}

export interface GoadDirectoryHost {
  key: string
  hostname: string
  domain: string
  role: DomainRole
  ipLastOctet?: number
}

export interface GoadDirectoryDomain {
  fqdn: string
  childOf: string | null
  trust: string | null
}

export interface GoadDirectory {
  hosts: GoadDirectoryHost[]
  domains: GoadDirectoryDomain[]
  /** Ludus VM rows for the extensions included in this read. */
  vms?: GoadPlannedVm[]
}

export const EMPTY_GOAD_DIRECTORY: GoadDirectory = { hosts: [], domains: [] }

const SAFE_GOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const JOIN_ROLES = new Set(["commonwkstn", "member_server"])
/** GOAD's shared play targets these inventory groups, not one host key. */
const JOIN_GROUPS: Record<string, string> = {
  workstation: "workstation",
  workstations: "workstation",
  server: "server",
  servers: "server",
}

/**
 * GOAD joins a workstation with the `commonwkstn` role and a server with
 * `member_server`. The shared play targets the `workstation` and `server`
 * inventory groups; an extension install names the host. `member_domain` is
 * the domain. A concrete name fills a host that has none.
 * `{{lab.hosts[dict_key].domain}}` keeps the domain already on the host,
 * including one read from `lab_extension`.
 */
export function applyMemberDomains(hosts: readonly GoadRawHost[], joins: readonly GoadJoinHint[]): GoadRawHost[] {
  const next = hosts.map((host) => ({ ...host }))
  const byKey = new Map(next.map((host) => [host.key.trim().toLowerCase(), host]))
  const fill = (host: GoadRawHost, literal: string) => {
    if (!host.domain.trim() && literal) host.domain = literal
  }
  for (const join of joins) {
    const role = join.role.trim().toLowerCase()
    if (!JOIN_ROLES.has(role)) continue
    const target = join.hosts.split(/[\s:]+/)[0]?.trim().toLowerCase() ?? ""
    if (!target || target === "all" || target === "domain" || target === "extensions") continue
    const rawDomain = join.memberDomain.trim().replace(/^['"]|['"]$/g, "")
    const literal = rawDomain.includes("{{") ? "" : rawDomain
    const groupType = JOIN_GROUPS[target]
    if (groupType) {
      for (const host of next) {
        if (host.type.trim().toLowerCase() !== groupType) continue
        fill(host, literal)
      }
      continue
    }
    let host = byKey.get(target)
    if (!host) {
      if (!literal) continue
      host = {
        key: target,
        hostname: "",
        type: role === "commonwkstn" ? "workstation" : "server",
        domain: literal,
      }
      next.push(host)
      byKey.set(target, host)
      continue
    }
    fill(host, literal)
  }
  return next
}

const PLAY_SKIP = new Set(["all", "domain", "extensions", "ungrouped"])

function literalFqdn(value: string): string {
  const raw = value.trim().replace(/^['"]|['"]$/g, "")
  if (!raw || raw.includes("{") || raw.includes("}")) return ""
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(raw)) return ""
  return raw
}

function isHostOwnDomain(value: string): boolean {
  return /lab\.hosts\[\s*dict_key\s*\]\.domain/i.test(value)
}

function hostLookupDomain(value: string, byKey: ReadonlyMap<string, GoadRawHost>): string {
  const match = value.match(/lab\.hosts\[\s*['"]([^'"]+)['"]\s*\]\.domain/i)
  if (!match) return ""
  return byKey.get(match[1]!.trim().toLowerCase())?.domain.trim() ?? ""
}

type PlayEffect = "primary" | "child" | "alt" | "server" | "workstation" | "linux"

function playEffect(roles: readonly string[]): PlayEffect | null {
  const names = roles.map((role) => role.trim().toLowerCase())
  const has = (role: string) => names.some((name) => name === role || name.endsWith(`/${role}`))
  if (has("domain_controller")) return "primary"
  if (has("child_domain")) return "child"
  if (has("domain_controller_slave")) return "alt"
  if (has("member_server")) return "server"
  if (has("commonwkstn")) return "workstation"
  if (has("add_linux_to_domain")) return "linux"
  return null
}

function expandPlayTarget(
  target: string,
  extension: string,
  groups: readonly GoadInventoryGroup[],
  seen = new Set<string>(),
): string[] {
  const name = target.trim().toLowerCase()
  if (!name || name.includes(":") || PLAY_SKIP.has(name) || seen.has(`${extension}:${name}`)) return []
  seen.add(`${extension}:${name}`)
  const group =
    groups.find((entry) => entry.extension === extension && entry.name === name) ??
    groups.find((entry) => entry.extension === "" && entry.name === name)
  if (!group) return [name]
  const hosts = [...group.hosts]
  for (const child of group.children) hosts.push(...expandPlayTarget(child, group.extension, groups, seen))
  return [...new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean))]
}

function resolvePlayDomain(
  play: GoadPlay,
  effect: PlayEffect,
  hostKey: string,
  byKey: ReadonlyMap<string, GoadRawHost>,
): string {
  const candidates =
    effect === "server" || effect === "workstation" || effect === "linux"
      ? [play.memberDomain, play.domain]
      : [play.domain, play.domainName, play.memberDomain]
  for (const value of candidates) {
    const literal = literalFqdn(value)
    if (literal) return literal
    const lookedUp = hostLookupDomain(value, byKey)
    if (lookedUp) return lookedUp
    if (isHostOwnDomain(value)) {
      const own = byKey.get(hostKey)?.domain.trim()
      if (own) return own
    }
  }
  return ""
}

/**
 * Learn domains from GOAD plays. `member_server` and `commonwkstn` join the
 * inventory hosts they target. `domain_controller` and `child_domain` create
 * the domain named in the play and put those hosts in it as DCs. The Ludus VM
 * name is not used; the inventory address is.
 */
export function learnGoadDomains(
  hosts: readonly GoadRawHost[],
  domains: readonly GoadRawDomain[],
  plays: readonly GoadPlay[],
  inventory: readonly GoadInventoryHost[],
  groups: readonly GoadInventoryGroup[] = [],
): { hosts: GoadRawHost[]; domains: GoadRawDomain[] } {
  const next = hosts.map((host) => ({ ...host }))
  const byKey = new Map(next.map((host) => [host.key.trim().toLowerCase(), host]))
  const domainRows = domains.map((domain) => ({ ...domain }))
  const domainByName = new Map(domainRows.map((domain) => [domain.fqdn.trim().toLowerCase(), domain]))
  const octetOf = new Map<string, number>()
  for (const row of inventory) {
    const key = `${row.extension}\0${row.host.trim().toLowerCase()}`
    if (row.octet > 0 && !octetOf.has(key)) octetOf.set(key, row.octet)
    const any = `\0${row.host.trim().toLowerCase()}`
    if (row.octet > 0 && !octetOf.has(any)) octetOf.set(any, row.octet)
  }

  const ensure = (key: string, domain: string, type: string, octet: number) => {
    let host = byKey.get(key)
    if (!host) {
      if (!domain) return null
      host = { key, hostname: "", type, domain, ipLastOctet: octet || undefined }
      next.push(host)
      byKey.set(key, host)
      return host
    }
    if (!host.domain.trim() && domain) host.domain = domain
    if (!host.type.trim() && type) host.type = type
    if (!host.ipLastOctet && octet) host.ipLastOctet = octet
    return host
  }

  for (const play of plays) {
    const effect = playEffect(play.roles)
    if (!effect) continue
    const type = effect === "workstation" ? "workstation" : effect === "server" || effect === "linux" ? "server" : "dc"
    for (const target of play.hosts) {
      for (const key of expandPlayTarget(target, play.extension, groups)) {
        const octet =
          octetOf.get(`${play.extension}\0${key}`) ??
          octetOf.get(`\0${key}`) ??
          0
        const domain = resolvePlayDomain(play, effect, key, byKey)
        const host = ensure(key, domain, type, octet)
        if (!host) continue
        if ((effect === "primary" || effect === "child") && host.domain.trim()) {
          const fqdn = host.domain.trim()
          const id = fqdn.toLowerCase()
          let row = domainByName.get(id)
          if (!row) {
            row = { fqdn, dc: key, trust: "" }
            domainRows.push(row)
            domainByName.set(id, row)
          } else if (!row.dc.trim()) {
            row.dc = key
          }
          if (effect === "child" && !row.parent) {
            const named = literalFqdn(play.parentDomain)
            const suffix = fqdn.includes(".") ? fqdn.split(".").slice(1).join(".") : ""
            const parent = named || (suffix.includes(".") ? suffix : "")
            if (parent && parent.toLowerCase() !== id) row.parent = parent
          }
        }
      }
    }
  }

  for (const row of inventory) {
    const host = byKey.get(row.host.trim().toLowerCase())
    if (host && !host.ipLastOctet && row.octet > 0) host.ipLastOctet = row.octet
  }

  return { hosts: next, domains: domainRows }
}

function samePlannedVm(vm: { vmName: string; hostname: string }, planned: GoadPlannedVm, rangeId: string): boolean {
  const expand = (value: string) => (rangeId ? value.replace(/\{\{\s*range_id\s*\}\}/gi, rangeId) : value).trim().toLowerCase()
  const names = new Set([expand(vm.vmName), expand(vm.hostname)].filter(Boolean))
  return names.has(expand(planned.vmName)) || names.has(expand(planned.hostname))
}

/**
 * Add extension VMs that are not in the range config yet, and mark every VM
 * that belongs to a staged extension. Domain membership is filled afterwards
 * by `overlayGoadDomains`.
 */
export function addPlannedExtensionVms(
  graph: BuilderGraph,
  planned: readonly GoadPlannedVm[],
  rangeId: string,
): { graph: BuilderGraph; pendingVmIds: string[] } {
  if (planned.length === 0) return { graph, pendingVmIds: [] }
  const vms = graph.vms.map((vm) => ({ ...vm }))
  const vlans = graph.vlans.map((vlan) => ({ ...vlan, vmIds: [...vlan.vmIds] }))
  const pendingVmIds: string[] = []
  for (const plan of planned) {
    const existing = vms.find((vm) => samePlannedVm(vm, plan, rangeId))
    if (existing) {
      pendingVmIds.push(existing.id)
      continue
    }
    const id = plan.vmName.trim() || plan.hostname.trim()
    if (!id || vms.some((vm) => vm.id === id)) continue
    vms.push({
      id,
      vmName: plan.vmName,
      hostname: plan.hostname || plan.vmName,
      template: plan.template,
      vlan: plan.vlan,
      ipLastOctet: plan.ipLastOctet,
      ramGb: plan.ramGb,
      cpus: plan.cpus,
      os: "windows",
      domainFqdn: null,
      domainRole: "none",
      roles: [],
      roleVars: {},
      raw: {},
    })
    pendingVmIds.push(id)
    if (!plan.vlan) continue
    let vlan = vlans.find((entry) => entry.vlan === plan.vlan)
    if (!vlan) {
      vlan = { vlan: plan.vlan, vmIds: [] }
      vlans.push(vlan)
    }
    if (!vlan.vmIds.includes(id)) vlan.vmIds.push(id)
  }
  if (pendingVmIds.length === 0) return { graph, pendingVmIds: [] }
  return {
    graph: { ...graph, vms, vlans: vlans.sort((a, b) => a.vlan - b.vlan) },
    pendingVmIds,
  }
}

export function isSafeGoadName(value: string): boolean {
  return SAFE_GOAD_NAME.test(value)
}

/**
 * Turn GOAD lab host and domain records into DC / member roles.
 * A domain whose name is a DNS child of another domain in the lab is a child domain.
 * `domains[fqdn].dc` is the primary DC. Other `type: dc` hosts are alternate DCs.
 */
export function buildGoadDirectory(rawHosts: readonly GoadRawHost[], rawDomains: readonly GoadRawDomain[]): GoadDirectory {
  const fqdnCanonical = new Map<string, string>()
  const dcByDomain = new Map<string, string>()
  const trustByDomain = new Map<string, string>()

  for (const domain of rawDomains) {
    const fqdn = domain.fqdn.trim()
    if (!fqdn) continue
    fqdnCanonical.set(fqdn.toLowerCase(), fqdn)
    const dc = domain.dc.trim().toLowerCase()
    if (dc) dcByDomain.set(fqdn.toLowerCase(), dc)
    const trust = domain.trust.trim()
    if (trust) trustByDomain.set(fqdn.toLowerCase(), trust)
  }
  for (const host of rawHosts) {
    const fqdn = host.domain.trim()
    if (fqdn && !fqdnCanonical.has(fqdn.toLowerCase())) fqdnCanonical.set(fqdn.toLowerCase(), fqdn)
  }

  const explicitParent = new Map<string, string>()
  for (const domain of rawDomains) {
    const parent = domain.parent?.trim()
    const fqdn = domain.fqdn.trim()
    if (parent && fqdn) explicitParent.set(fqdn.toLowerCase(), parent)
  }

  const childOf = (fqdn: string): string | null => {
    const lower = fqdn.toLowerCase()
    let best: string | null = null
    for (const other of fqdnCanonical.values()) {
      const candidate = other.toLowerCase()
      if (candidate === lower) continue
      if (lower.endsWith(`.${candidate}`) && (best == null || candidate.length > best.length)) best = other
    }
    return best
  }

  const hosts: GoadDirectoryHost[] = []
  const seen = new Set<string>()
  const primaryAssigned = new Set<string>()
  for (const host of rawHosts) {
    const key = host.key.trim()
    const domain = host.domain.trim()
    if (!key || !domain) continue
    const id = key.toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    const domainKey = domain.toLowerCase()
    const namedDc = dcByDomain.get(domainKey)
    const isDc = host.type.trim().toLowerCase() === "dc"
    let role: DomainRole = "member"
    if (namedDc && id === namedDc) {
      role = "primary-dc"
      primaryAssigned.add(domainKey)
    } else if (isDc && !namedDc && !primaryAssigned.has(domainKey)) {
      role = "primary-dc"
      primaryAssigned.add(domainKey)
    } else if (isDc) {
      role = "alt-dc"
    }
    hosts.push({
      key,
      hostname: host.hostname.trim(),
      domain: fqdnCanonical.get(domainKey) ?? domain,
      role,
      ipLastOctet: host.ipLastOctet || undefined,
    })
  }

  const domains = [...fqdnCanonical.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([, fqdn]) => ({
      fqdn,
      childOf: explicitParent.get(fqdn.toLowerCase()) ?? childOf(fqdn),
      trust: trustByDomain.get(fqdn.toLowerCase()) ?? null,
    }))

  return { hosts, domains }
}

function expandRangeId(value: string, rangeId: string): string {
  return rangeId ? value.replace(/\{\{\s*range_id\s*\}\}/gi, rangeId) : value
}

function nameTokens(value: string, rangeId: string): string[] {
  return expandRangeId(value, rangeId).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0)
}

/** Hyphens removed, so `w11-25h2` and `W1125H2` compare as the same name. */
function compactGoadName(value: string, rangeId: string): string {
  return expandRangeId(value, rangeId).toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/**
 * A deployed VM can keep an older name after the extension host key changes.
 * The template and last octet still identify that extension's machine.
 */
export function matchGoadHostBySlot(
  vm: { template: string; ipLastOctet: number },
  hosts: readonly GoadDirectoryHost[],
  planned: readonly GoadPlannedVm[] | undefined,
): GoadDirectoryHost | null {
  const template = vm.template.trim()
  if (!template || !vm.ipLastOctet || !planned?.length) return null
  const hits = planned.filter((plan) => plan.template === template && plan.ipLastOctet === vm.ipLastOctet)
  if (hits.length !== 1) return null
  return matchGoadHost({ vmName: hits[0]!.vmName, hostname: hits[0]!.hostname }, "", hosts)
}

/**
 * The play names an inventory host and a domain. The Ludus VM is the machine
 * at that host's address with the extension template, whatever its name is.
 */
export function matchGoadHostByAddress(
  vm: { template: string; ipLastOctet: number },
  hosts: readonly GoadDirectoryHost[],
  planned: readonly GoadPlannedVm[] | undefined,
): GoadDirectoryHost | null {
  const template = vm.template.trim()
  if (!template || !vm.ipLastOctet) return null
  const plans = (planned ?? []).filter((plan) => plan.template === template && plan.ipLastOctet === vm.ipLastOctet)
  if (plans.length !== 1) return null
  const hits = hosts.filter((host) => host.ipLastOctet === vm.ipLastOctet && host.domain.trim())
  if (hits.length === 0) return null
  const domains = new Set(hits.map((host) => host.domain.toLowerCase()))
  if (domains.size !== 1) return null
  return hits[0]!
}

/**
 * GOAD gives each inventory host one last octet. A deployed VM keeps that
 * address when its name changes. Two hosts at the same octet are left alone.
 */
export function matchGoadHostByOctet(
  vm: { ipLastOctet: number },
  hosts: readonly GoadDirectoryHost[],
): GoadDirectoryHost | null {
  if (!vm.ipLastOctet) return null
  const hits = hosts.filter((host) => host.ipLastOctet === vm.ipLastOctet && host.domain.trim())
  if (hits.length !== 1) return null
  return hits[0]!
}

/** Match a Ludus VM name such as `{{ range_id }}-GOAD-DC01` to a GOAD host key. */
export function matchGoadHost(
  vm: { vmName: string; hostname: string },
  rangeId: string,
  hosts: readonly GoadDirectoryHost[],
): GoadDirectoryHost | null {
  const tokens = new Set([...nameTokens(vm.vmName, rangeId), ...nameTokens(vm.hostname, rangeId)])
  const compactNames = [compactGoadName(vm.vmName, rangeId), compactGoadName(vm.hostname, rangeId)].filter(Boolean)
  const ranked = [...hosts].sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key))
  for (const host of ranked) {
    if (tokens.has(host.key.toLowerCase())) return host
    const hostname = host.hostname.toLowerCase()
    // GOAD SCCM names the DC hostname "DC" and the Ludus VM "{{ range_id }}-SCCM-DC".
    if (hostname.length >= 2 && tokens.has(hostname)) return host
    // Extension host keys keep hyphens (`w11-25h2`) that the Ludus hostname drops (`W1125H2`).
    if (/[^a-z0-9]/i.test(host.key)) {
      const keyCompact = compactGoadName(host.key, "")
      if (keyCompact.length >= 4 && compactNames.some((name) => name.includes(keyCompact))) return host
    }
  }
  return null
}

export interface NamedGoadDirectory {
  name: string
  hosts: GoadDirectoryHost[]
  domains: GoadDirectoryDomain[]
}

/**
 * Pick the GOAD lab whose hosts match this range when the range is not linked to
 * an instance. Requires two matches and a single best lab, so a normal Ludus DC
 * named dc01 does not inherit a whole lab.
 */
export function pickGoadDirectory(
  vms: readonly { vmName: string; hostname: string; domainFqdn: string | null }[],
  rangeId: string,
  catalog: { labs: readonly NamedGoadDirectory[]; extensions: readonly NamedGoadDirectory[] },
): GoadDirectory | null {
  const open = vms.filter((vm) => !vm.domainFqdn)
  if (open.length === 0) return null
  let best: NamedGoadDirectory | null = null
  let bestHits = 0
  let tied = false
  for (const lab of catalog.labs) {
    const hits = open.filter((vm) => matchGoadHost(vm, rangeId, lab.hosts) != null).length
    if (hits === 0 || hits < bestHits) continue
    if (hits === bestHits) {
      tied = true
      continue
    }
    best = lab
    bestHits = hits
    tied = false
  }
  if (!best || tied || bestHits < 2) return null

  const hosts = [...best.hosts]
  const domains = [...best.domains]
  const seenHosts = new Set(hosts.map((host) => host.key.toLowerCase()))
  const seenDomains = new Set(domains.map((domain) => domain.fqdn.toLowerCase()))
  for (const ext of catalog.extensions) {
    if (!open.some((vm) => matchGoadHost(vm, rangeId, ext.hosts) != null)) continue
    for (const host of ext.hosts) {
      const key = host.key.toLowerCase()
      if (seenHosts.has(key)) continue
      seenHosts.add(key)
      hosts.push(host)
    }
    for (const domain of ext.domains) {
      const key = domain.fqdn.toLowerCase()
      if (seenDomains.has(key)) continue
      seenDomains.add(key)
      domains.push(domain)
    }
  }
  return { hosts, domains }
}

/**
 * Fill domain, DC, and member on a graph from the GOAD lab when range-config.yml
 * does not already say which domain a machine belongs to. Does not edit the document.
 */
export function overlayGoadDomains(graph: BuilderGraph, directory: GoadDirectory | null, rangeId: string): BuilderGraph {
  if (!directory || directory.hosts.length === 0) return graph
  const vms = graph.vms.map((vm) => {
    if (vm.domainFqdn) return vm
    const host =
      matchGoadHost(vm, rangeId, directory.hosts) ??
      matchGoadHostBySlot(vm, directory.hosts, directory.vms) ??
      matchGoadHostByAddress(vm, directory.hosts, directory.vms) ??
      matchGoadHostByOctet(vm, directory.hosts)
    if (!host) return vm
    return { ...vm, domainFqdn: host.domain, domainRole: host.role }
  })

  const prior = new Map(graph.domains.map((domain) => [domain.fqdn, domain]))
  const domainMap = new Map<string, BuilderGraph["domains"][number]>()
  for (const vm of vms) {
    if (!vm.domainFqdn) continue
    let domain = domainMap.get(vm.domainFqdn)
    if (!domain) {
      domain = {
        fqdn: vm.domainFqdn,
        vmIds: [],
        primaryDcVmId: null,
        childOfFqdn: prior.get(vm.domainFqdn)?.childOfFqdn ?? null,
      }
      domainMap.set(vm.domainFqdn, domain)
    }
    domain.vmIds.push(vm.id)
    if (vm.domainRole === "primary-dc" && !domain.primaryDcVmId) domain.primaryDcVmId = vm.id
  }
  for (const existing of graph.domains) {
    if (!domainMap.has(existing.fqdn)) domainMap.set(existing.fqdn, { ...existing, vmIds: [] })
  }
  for (const info of directory.domains) {
    const domain = domainMap.get(info.fqdn)
    if (domain && !domain.childOfFqdn && info.childOf) domain.childOfFqdn = info.childOf
  }

  const trusts: BuilderTrust[] = [...graph.trusts]
  for (const info of directory.domains) {
    if (!info.trust) continue
    const from = info.fqdn
    const to = info.trust
    const fromDomain = domainMap.get(from)
    const toDomain = domainMap.get(to)
    if (!fromDomain?.vmIds.length || !toDomain?.vmIds.length) continue
    if (trusts.some((trust) => trust.fromFqdn === from && trust.toFqdn === to)) continue
    trusts.push({
      sourceVmId: `goad:${from}>${to}`,
      fromFqdn: from,
      toFqdn: to,
      sidHistory: false,
    })
  }

  return {
    ...graph,
    vms,
    domains: [...domainMap.values()].sort((a, b) => a.fqdn.localeCompare(b.fqdn)),
    trusts,
  }
}
