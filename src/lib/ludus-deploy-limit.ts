/**
 * Host limit helpers for Ludus `range deploy --limit` / POST /range/deploy `limit`.
 */

import yaml from "js-yaml"
import { isLudusRangeRouterVmName } from "./ludus-range-router-vm"

const RANGE_ID_PLACEHOLDER = /\{\{\s*range_id\s*\}\}/gi

/** Ansible inventory host keys — exclude vars, groups, CLI flags. */
export function isAnsibleInventoryHostKey(name: string): boolean {
  const n = name.trim()
  if (!n) return false
  if (n.startsWith("-")) return false
  if (n.includes("=")) return false
  if (n.endsWith(":")) return false
  if (/^ansible_/i.test(n)) return false
  if (n.startsWith("[")) return false
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(n)
}

/** Replace Ludus `{{ range_id }}` placeholders with the active range ID. */
export function resolveRangeIdInHost(value: string, rangeId: string): string {
  const id = rangeId.trim()
  if (!id) return value.trim()
  return value.trim().replace(RANGE_ID_PLACEHOLDER, id)
}

function dedupeSorted(hosts: string[]): string[] {
  return [...new Set(hosts.map((h) => h.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )
}

/** Default Ludus router Proxmox vm_name when `router:` is omitted from range config. */
export function ludusDefaultRouterVmName(rangeId: string): string {
  return `${rangeId.trim()}-router-debian11-x64`
}

/** Ludus default router label in config UI (`{range_id}-router` shorthand). */
export function ludusDefaultRouterHostname(rangeId: string): string {
  return `${rangeId.trim()}-router`
}

function parseRouterBlockFields(yamlText: string): { vmName: string; hostname: string } | null {
  const routerBlock = yamlText.match(/^router:\s*\n((?:[ \t].*\n?)*)/m)?.[1]
  if (!routerBlock) return null
  const get = (key: string): string => {
    const m = routerBlock.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"))
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
  }
  const vmName = get("vm_name")
  if (!vmName) return null
  return { vmName, hostname: get("hostname") || vmName }
}

/** Proxmox vm_name for router when building Ludus deploy `limit` (not UI shorthand). */
export function resolveRouterLimitVmNameForDeploy(
  configYaml: string,
  rangeId: string,
  deployedVms?: Array<{ name?: string }>,
): string | null {
  if (!rangeId.trim()) return null
  if (deployedVms?.length) {
    for (const vm of deployedVms) {
      const name = vm.name?.trim()
      if (name && isLudusRangeRouterVmName(name)) return name
    }
  }
  const explicit = parseRouterBlockFields(configYaml)
  if (explicit) {
    return resolveRangeIdInHost(explicit.vmName, rangeId)
  }
  return ludusDefaultRouterVmName(rangeId)
}

function isRouterLimitShorthand(host: string, rangeId: string): boolean {
  const trimmed = host.trim()
  const id = rangeId.trim()
  return trimmed === ludusDefaultRouterHostname(id)
}

function hostMatchesRouterLimit(
  host: string,
  rangeId: string,
  routerVmName: string | null,
): boolean {
  const trimmed = host.trim()
  if (!trimmed) return false
  if (isLudusRangeRouterVmName(trimmed)) return true
  if (isRouterLimitShorthand(trimmed, rangeId)) return true
  return routerVmName != null && trimmed === routerVmName
}

/** Map UI shorthand / sync labels to Proxmox vm_name for Ludus deploy `limit`. */
export function normalizeLimitHostForDeploy(
  host: string,
  configYaml: string,
  rangeId: string,
  deployedVms?: Array<{ name?: string }>,
): string {
  const trimmed = host.trim()
  if (!trimmed) return trimmed
  if (isRouterLimitShorthand(trimmed, rangeId) || isLudusRangeRouterVmName(trimmed)) {
    return resolveRouterLimitVmNameForDeploy(configYaml, rangeId, deployedVms) ?? trimmed
  }
  return trimmed
}

/**
 * When limiting deploy to subset of VMs, always include the range router so DNS/network
 * plays match (Ludus limit uses Proxmox vm_name, not `{range_id}-router` shorthand).
 */
export function expandDeployLimitHosts(
  selectedHosts: string[],
  configYaml: string,
  rangeId: string,
  deployedVms?: Array<{ name?: string }>,
): string[] {
  if (selectedHosts.length === 0) return []
  const routerVm = resolveRouterLimitVmNameForDeploy(configYaml, rangeId, deployedVms)
  const normalized = selectedHosts.map((h) =>
    normalizeLimitHostForDeploy(h, configYaml, rangeId, deployedVms),
  )
  if (!routerVm) return dedupeSorted(normalized)
  const hasRouter = normalized.some((h) => hostMatchesRouterLimit(h, rangeId, routerVm))
  if (hasRouter) return dedupeSorted(normalized)
  return dedupeSorted([...normalized, routerVm])
}

/** UI label for router in config host list (`{range_id}-router` shorthand). */
export function resolveRouterLimitHost(yamlText: string, rangeId?: string): string | null {
  if (!rangeId?.trim()) return null
  const explicit = parseRouterBlockFields(yamlText)
  if (explicit) {
    return resolveRangeIdInHost(explicit.vmName, rangeId)
  }
  return ludusDefaultRouterHostname(rangeId)
}

/** Parse Ludus deploy limit host keys (vm_name) from range-config YAML (VMs + router). */
export function parseHostsFromRangeConfig(yamlText: string, rangeId?: string): string[] {
  if (!yamlText.trim()) return []
  const hosts: string[] = []
  const blocks = yamlText.split(/(?=^\s*- vm_name:)/m)
  for (const block of blocks) {
    const get = (key: string): string => {
      const m = block.match(new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*(.+)$`, "m"))
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
    }
    const vmName = get("vm_name")
    if (!vmName) continue
    const resolved = rangeId ? resolveRangeIdInHost(vmName, rangeId) : vmName
    hosts.push(resolved)
  }
  const routerHost = resolveRouterLimitHost(yamlText, rangeId)
  if (routerHost) hosts.push(routerHost)
  return dedupeSorted(hosts)
}

/** Resolve GET /range VM name to Ludus deploy `limit` host key. */
export function resolveLimitHostForRangeVm(
  vmName: string,
  configYaml: string,
  rangeId: string,
): string {
  const trimmed = vmName.trim()
  if (!trimmed) return trimmed
  if (isLudusRangeRouterVmName(trimmed) && !parseRouterBlockFields(configYaml)) {
    return ludusDefaultRouterHostname(rangeId)
  }
  return trimmed
}

/** Build limit host list from GET /range VMs ([List range VMs](https://api-docs.ludus.cloud/list-range-vms-power-state-and-testing-state-24251980e0)). */
export function limitHostsFromRangeVms(
  vms: Array<{ name?: string }>,
  configYaml: string,
  rangeId: string,
): string[] {
  const hosts: string[] = []
  for (const vm of vms) {
    const name = vm.name?.trim()
    if (!name) continue
    const host = resolveLimitHostForRangeVm(name, configYaml, rangeId)
    if (isAnsibleInventoryHostKey(host)) hosts.push(host)
  }
  return dedupeSorted(hosts)
}

function collectYamlInventoryHosts(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return
  const obj = node as Record<string, unknown>

  const hostsBlock = obj.hosts
  if (hostsBlock && typeof hostsBlock === "object" && !Array.isArray(hostsBlock)) {
    for (const key of Object.keys(hostsBlock as Record<string, unknown>)) {
      if (isAnsibleInventoryHostKey(key)) into.add(key)
    }
  }

  const children = obj.children
  if (children && typeof children === "object" && !Array.isArray(children)) {
    for (const child of Object.values(children as Record<string, unknown>)) {
      collectYamlInventoryHosts(child, into)
    }
  }
}

function parseStructuredInventory(text: string): string[] | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  let doc: unknown
  if (trimmed.startsWith("{")) {
    try {
      doc = JSON.parse(trimmed)
    } catch {
      doc = undefined
    }
  } else {
    try {
      doc = yaml.load(trimmed)
    } catch {
      doc = undefined
    }
  }

  if (!doc || typeof doc !== "object") return null

  const hosts = new Set<string>()
  const root = doc as Record<string, unknown>
  if (root.all) {
    collectYamlInventoryHosts(root.all, hosts)
  } else {
    collectYamlInventoryHosts(doc, hosts)
  }

  return hosts.size > 0 ? dedupeSorted([...hosts]) : null
}

/** Parse INI-style inventory host keys (first token on host lines). */
function parseIniInventoryHosts(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const hosts: string[] = []
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue
    if (trimmed.startsWith("[")) continue
    const token = trimmed.split(/\s+/)[0]
    if (!isAnsibleInventoryHostKey(token)) continue
    hosts.push(token)
  }
  return dedupeSorted(hosts)
}

/** Parse Ludus/Ansible inventory text (YAML/JSON preferred, INI fallback). */
export function parseAnsibleInventoryHosts(inventoryText: string): string[] {
  const structured = parseStructuredInventory(inventoryText)
  if (structured) return structured
  return parseIniInventoryHosts(inventoryText)
}

/** Normalize Ludus inventory API payload to plain text or JSON for parsing. */
export function extractInventoryText(data: unknown): string {
  if (data == null) return ""
  if (typeof data === "string") return data
  if (typeof data !== "object") return String(data)
  const d = data as { result?: unknown }
  if (typeof d.result === "string") return d.result
  if (d.result != null && typeof d.result === "object") {
    try {
      return JSON.stringify(d.result)
    } catch {
      return String(d.result)
    }
  }
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

/** Parse host keys from Ludus inventory API payload (string, YAML, JSON, or envelope). */
export function parseAnsibleInventoryFromLudusPayload(data: unknown): string[] {
  if (data == null) return []
  const d = data as { result?: unknown }
  if (d.result != null && typeof d.result === "object" && !Array.isArray(d.result)) {
    const fromObj = parseStructuredInventory(JSON.stringify(d.result))
    if (fromObj?.length) return fromObj
  }
  return parseAnsibleInventoryHosts(extractInventoryText(data))
}

/** Inventory supersedes config when non-empty; otherwise keep config fallback. */
export function mergeDeployLimitHosts(configHosts: string[], inventoryHosts: string[]): string[] {
  if (inventoryHosts.length > 0) return inventoryHosts
  return configHosts
}

/** Comma-join selected hosts for Ludus deploy `limit` body field. */
export function buildDeployLimitPattern(selectedHosts: string[]): string | undefined {
  const cleaned = dedupeSorted(selectedHosts)
  return cleaned.length > 0 ? cleaned.join(",") : undefined
}

export interface ResolveDeployLimitPatternOptions {
  rangeId?: string
  configYaml?: string
  deployedVms?: Array<{ name?: string }>
  /** When true (default), append range router vm_name if missing from selection. */
  includeRouter?: boolean
}

/** Effective limit: custom pattern wins; checkbox selection expands router + normalizes vm_name. */
export function resolveDeployLimitPattern(
  selectedHosts: string[],
  customPattern: string,
  options?: ResolveDeployLimitPatternOptions,
): string | undefined {
  const custom = customPattern.trim()
  if (custom) return custom
  if (selectedHosts.length === 0) return undefined

  const includeRouter = options?.includeRouter !== false
  const rangeId = options?.rangeId?.trim()
  const configYaml = options?.configYaml ?? ""

  const hosts =
    includeRouter && rangeId
      ? expandDeployLimitHosts(selectedHosts, configYaml, rangeId, options?.deployedVms)
      : selectedHosts.map((h) =>
          rangeId
            ? normalizeLimitHostForDeploy(h, configYaml, rangeId, options?.deployedVms)
            : h.trim(),
        )

  return buildDeployLimitPattern(hosts)
}
