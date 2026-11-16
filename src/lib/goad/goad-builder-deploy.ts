/**
 * Range Builder hands a chosen GOAD lab to Deploy New GOAD Instance.
 * The wizard reads this once, starts the same install, and opens the lab deployment page.
 */

import type { NetworkRule, Protocol, RuleAction, VlanValue } from "@/lib/range/network-rules"

const HANDOFF_KEY = "lux-builder-goad-deploy"
const STARTED_KEY = "lux-builder-goad-deploy-started"

export interface GoadBuilderDeployHandoff {
  rangeId: string
  lab: string
  extensions: string[]
  /** Distinguishes a new Deploy click from a refresh of the previous one. */
  nonce: string
  /** Canvas firewall rules the user approved. Absent when they did not edit rules. */
  networkRules?: NetworkRule[]
  /** The lab config replaces the range. Previous firewall rules are not kept. */
  replacesConfig?: boolean
}

function storage(): Storage | null {
  if (typeof sessionStorage === "undefined") return null
  return sessionStorage
}

function cleanToken(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  if (/[\r\n\0]/.test(trimmed)) return null
  return trimmed
}

export function parseGoadBuilderDeploy(raw: string): GoadBuilderDeployHandoff | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>
  const rangeId = cleanToken(record.rangeId, 200)
  const lab = cleanToken(record.lab, 200)
  const nonce = cleanToken(record.nonce, 80)
  if (!rangeId || !lab || !nonce) return null
  if (!Array.isArray(record.extensions) || record.extensions.length > 50) return null
  const extensions: string[] = []
  for (const entry of record.extensions) {
    const name = cleanToken(entry, 200)
    if (!name || extensions.includes(name)) return null
    extensions.push(name)
  }
  const replacesConfig = record.replacesConfig === true
  if (record.networkRules == null) {
    return replacesConfig ? { rangeId, lab, extensions, nonce, replacesConfig } : { rangeId, lab, extensions, nonce }
  }
  const networkRules = parseHandoffRules(record.networkRules)
  if (!networkRules) return null
  return replacesConfig
    ? { rangeId, lab, extensions, nonce, networkRules, replacesConfig }
    : { rangeId, lab, extensions, nonce, networkRules }
}

function parseHandoffRules(value: unknown): NetworkRule[] | null {
  if (!Array.isArray(value) || value.length > 100) return null
  const rules: NetworkRule[] = []
  for (const entry of value) {
    const rule = parseHandoffRule(entry)
    if (!rule) return null
    rules.push(rule)
  }
  return rules
}

function parseHandoffRule(value: unknown): NetworkRule | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.name !== "string" || record.name.length > 200) return null
  const name = record.name.trim()
  const vlan_src = parseHandoffVlan(record.vlan_src)
  const vlan_dst = parseHandoffVlan(record.vlan_dst)
  const protocol = parseHandoffProtocol(record.protocol)
  const action = parseHandoffAction(record.action)
  if (vlan_src == null || vlan_dst == null || !protocol || !action) return null
  if (typeof record.ports !== "string" || !record.ports.trim() || record.ports.length > 200) return null
  const rule: NetworkRule = { name, vlan_src, vlan_dst, protocol, ports: record.ports.trim(), action }
  if (record.ip_last_octet_src != null) {
    const octet = parseHandoffOctet(record.ip_last_octet_src)
    if (!octet) return null
    rule.ip_last_octet_src = octet
  }
  if (record.ip_last_octet_dst != null) {
    const octet = parseHandoffOctet(record.ip_last_octet_dst)
    if (!octet) return null
    rule.ip_last_octet_dst = octet
  }
  return rule
}

function parseHandoffVlan(value: unknown): VlanValue | null {
  if (value === "wireguard" || value === "public" || value === "all") return value
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4094) return value
  return null
}

function parseHandoffProtocol(value: unknown): Protocol | null {
  if (value === "tcp" || value === "udp" || value === "all") return value
  return null
}

function parseHandoffAction(value: unknown): RuleAction | null {
  if (value === "ACCEPT" || value === "REJECT" || value === "DROP") return value
  return null
}

function parseHandoffOctet(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!/^\d{1,3}(?:-\d{1,3})?$/.test(trimmed)) return null
  return trimmed
}

export function readGoadBuilderDeploy(): GoadBuilderDeployHandoff | null {
  const store = storage()
  if (!store) return null
  const raw = store.getItem(HANDOFF_KEY)
  if (!raw) return null
  return parseGoadBuilderDeploy(raw)
}

export function writeGoadBuilderDeploy(input: {
  rangeId: string
  lab: string
  extensions: string[]
  networkRules?: NetworkRule[]
  replacesConfig?: boolean
}): GoadBuilderDeployHandoff | null {
  const store = storage()
  if (!store) return null
  const handoff: GoadBuilderDeployHandoff = {
    rangeId: input.rangeId.trim(),
    lab: input.lab.trim(),
    extensions: [...input.extensions],
    nonce: crypto.randomUUID(),
    ...(input.networkRules != null ? { networkRules: input.networkRules } : {}),
    ...(input.replacesConfig ? { replacesConfig: true } : {}),
  }
  const parsed = parseGoadBuilderDeploy(JSON.stringify(handoff))
  if (!parsed) return null
  store.setItem(HANDOFF_KEY, JSON.stringify(parsed))
  return parsed
}

/**
 * True the first time this nonce starts or is abandoned.
 * A second call, including a refresh, does not start another install.
 */
export function claimGoadBuilderDeploy(nonce: string): boolean {
  const store = storage()
  if (!store || !nonce) return false
  if (store.getItem(STARTED_KEY) === nonce) return false
  store.setItem(STARTED_KEY, nonce)
  store.removeItem(HANDOFF_KEY)
  return true
}
