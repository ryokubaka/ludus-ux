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

/** Ludus default router Ansible hostname when `router:` is omitted from range config. */
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

/** Ansible --limit host key for the range router (explicit `router:` block or Ludus default). */
export function resolveRouterLimitHost(yamlText: string, rangeId?: string): string | null {
  if (!rangeId?.trim()) return null
  const explicit = parseRouterBlockFields(yamlText)
  if (explicit) {
    return resolveRangeIdInHost(explicit.hostname || explicit.vmName, rangeId)
  }
  return ludusDefaultRouterHostname(rangeId)
}

/** Parse Ansible inventory hostnames from range-config YAML (VMs + router). */
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
    // Ansible --limit matches inventory host keys (hostname), not Proxmox vm_name.
    const hostname = get("hostname") || vmName
    const resolved = rangeId ? resolveRangeIdInHost(hostname, rangeId) : hostname
    hosts.push(resolved)
  }
  const routerHost = resolveRouterLimitHost(yamlText, rangeId)
  if (routerHost) hosts.push(routerHost)
  return dedupeSorted(hosts)
}

/** Map resolved Proxmox vm_name → Ansible hostname from range-config YAML. */
export function parseVmNameToHostnameMap(yamlText: string, rangeId?: string): Map<string, string> {
  const map = new Map<string, string>()
  const put = (vmName: string, hostname: string) => {
    if (!vmName) return
    const resolvedVm = rangeId ? resolveRangeIdInHost(vmName, rangeId) : vmName
    const resolvedHost = rangeId ? resolveRangeIdInHost(hostname || vmName, rangeId) : hostname || vmName
    map.set(resolvedVm, resolvedHost)
  }

  const blocks = yamlText.split(/(?=^\s*- vm_name:)/m)
  for (const block of blocks) {
    const get = (key: string): string => {
      const m = block.match(new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*(.+)$`, "m"))
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
    }
    const vmName = get("vm_name")
    if (!vmName) continue
    put(vmName, get("hostname") || vmName)
  }

  const explicitRouter = parseRouterBlockFields(yamlText)
  if (explicitRouter) {
    put(explicitRouter.vmName, explicitRouter.hostname)
  } else if (rangeId) {
    // Ludus always provisions a default Debian router; inventory hostname is `{range_id}-router`.
    const routerHost = ludusDefaultRouterHostname(rangeId)
    map.set(routerHost, routerHost)
  }

  return map
}

/** Resolve GET /range VM name to Ansible --limit host key using config mapping. */
export function resolveLimitHostForRangeVm(
  vmName: string,
  configYaml: string,
  rangeId: string,
): string {
  const trimmed = vmName.trim()
  if (!trimmed) return trimmed
  const mapped = parseVmNameToHostnameMap(configYaml, rangeId).get(trimmed)
  if (mapped) return mapped
  if (isLudusRangeRouterVmName(trimmed)) {
    const routerHost = resolveRouterLimitHost(configYaml, rangeId)
    if (routerHost) return routerHost
  }
  const configHosts = parseHostsFromRangeConfig(configYaml, rangeId)
  if (configHosts.includes(trimmed)) return trimmed
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

/** Effective limit: custom pattern wins over checkbox selection. */
export function resolveDeployLimitPattern(
  selectedHosts: string[],
  customPattern: string,
): string | undefined {
  const custom = customPattern.trim()
  if (custom) return custom
  return buildDeployLimitPattern(selectedHosts)
}
