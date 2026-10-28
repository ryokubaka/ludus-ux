import yaml from "js-yaml"
import { buildNetworkYaml, type NetworkRule } from "@/lib/network-rules"

const YAML_DUMP_OPTS = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  quotingType: '"' as const,
  forceQuotes: false,
}

export interface VMEntry {
  id: string
  template: string
  vmName: string
  hostname: string
  vlan: number
  ipLastOctet: number
  ramGb: number
  cpus: number
  isLinux: boolean
  isWindows: boolean
  isServer: boolean
  domainRole: "none" | "primary-dc" | "alt-dc" | "member"
  testingSnapshot: boolean
  testingBlockInternet: boolean
  showAdvanced: boolean
}

export function inferOS(templateName: string): {
  isLinux: boolean
  isWindows: boolean
  isServer: boolean
} {
  const lower = templateName.toLowerCase()
  const isWindows = lower.includes("win")
  const isLinux = !isWindows
  const isServer = isWindows && (lower.includes("server") || lower.includes("dc"))
  return { isLinux, isWindows, isServer }
}

export function newVmEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
}

export function defaultsForTemplate(
  template: string,
  opts?: { vlan?: number; ipLastOctet?: number },
): VMEntry {
  const { isLinux, isWindows, isServer } = inferOS(template)
  const shortName = template.replace(/-template$/, "").replace(/-x64|-x86/g, "")
  const windowsShort = isWindows
    ? shortName.replace(/-?workstation$/i, "-ws").replace(/-?server$/i, "-srv")
    : shortName
  const hostnameSuffix = windowsShort.slice(0, isWindows ? 15 : 50)
  return {
    id: newVmEntryId(),
    template,
    vmName: `{{ range_id }}-${hostnameSuffix}`,
    hostname: hostnameSuffix,
    vlan: opts?.vlan ?? 10,
    ipLastOctet: opts?.ipLastOctet ?? 10,
    ramGb: isServer ? 8 : isLinux ? 4 : 8,
    cpus: isServer ? 4 : 2,
    isLinux,
    isWindows,
    isServer,
    domainRole: "none",
    testingSnapshot: true,
    testingBlockInternet: true,
    showAdvanced: true,
  }
}

export function vmEntryToLudusObject(vm: VMEntry, domainFqdn?: string | null): Record<string, unknown> {
  const vmName = vm.vmName || `{{ range_id }}-${vm.hostname}`
  const hostname = vm.hostname.includes("{{ range_id }}")
    ? vm.hostname
    : `{{ range_id }}-${vm.hostname}`
  const out: Record<string, unknown> = {
    vm_name: vmName,
    hostname,
    template: vm.template,
    vlan: vm.vlan,
    ip_last_octet: vm.ipLastOctet,
    ram_gb: vm.ramGb,
    cpus: vm.cpus,
  }
  if (vm.isLinux) out.linux = true
  if (vm.isWindows) out.windows = { sysprep: false }
  if (domainFqdn && vm.domainRole !== "none") {
    out.domain = { fqdn: domainFqdn, role: vm.domainRole }
  }
  out.testing = {
    snapshot: vm.testingSnapshot,
    block_internet: vm.testingBlockInternet,
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Default VLAN from first `ludus[]` entry, else 10. */
export function defaultVlanFromConfig(yamlText: string): number {
  try {
    const ludus = asRecord(yaml.load(yamlText))?.ludus
    if (!Array.isArray(ludus) || ludus.length === 0) return 10
    const first = asRecord(ludus[0])
    const vlan = Number(first?.vlan)
    return Number.isFinite(vlan) && vlan > 0 ? vlan : 10
  } catch {
    return 10
  }
}

/** Map vlan → set of used ip_last_octet values in existing config. */
export function collectIpLastOctetsByVlan(yamlText: string): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>()
  try {
    const ludus = asRecord(yaml.load(yamlText))?.ludus
    if (!Array.isArray(ludus)) return map
    for (const item of ludus) {
      const rec = asRecord(item)
      if (!rec) continue
      const vlan = Number(rec.vlan)
      const octet = Number(rec.ip_last_octet)
      if (!Number.isFinite(vlan) || !Number.isFinite(octet)) continue
      if (!map.has(vlan)) map.set(vlan, new Set())
      map.get(vlan)!.add(octet)
    }
  } catch {
    /* empty */
  }
  return map
}

/** Pick next free ip_last_octet on a VLAN (starts at 10, skips used). */
export function suggestIpLastOctetForVlan(
  yamlText: string,
  vlan: number,
  alsoReserved?: Set<number>,
): number {
  const used = collectIpLastOctetsByVlan(yamlText).get(vlan) ?? new Set<number>()
  for (let octet = 10; octet <= 254; octet++) {
    if (!used.has(octet) && !alsoReserved?.has(octet)) return octet
  }
  return 254
}

export function appendVmsToRangeConfig(yamlText: string, vms: VMEntry[]): string {
  if (vms.length === 0) return yamlText
  let doc: Record<string, unknown>
  try {
    const parsed = yaml.load(yamlText)
    doc = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>
  } catch {
    doc = {}
  }
  const ludus = Array.isArray(doc.ludus) ? [...doc.ludus] : []
  for (const vm of vms) {
    ludus.push(vmEntryToLudusObject(vm))
  }
  doc.ludus = ludus
  return yaml.dump(doc, YAML_DUMP_OPTS)
}

export function generateYaml(
  vms: VMEntry[],
  domainFqdn: string | null,
  networkRules: NetworkRule[],
): string {
  const lines: string[] = ["ludus:"]
  for (const vm of vms) {
    const vmName = vm.vmName || `{{ range_id }}-${vm.hostname}`
    const hostname = `{{ range_id }}-${vm.hostname}`
    lines.push(`  - vm_name: "${vmName}"`)
    lines.push(`    hostname: "${hostname}"`)
    lines.push(`    template: ${vm.template}`)
    lines.push(`    vlan: ${vm.vlan}`)
    lines.push(`    ip_last_octet: ${vm.ipLastOctet}`)
    lines.push(`    ram_gb: ${vm.ramGb}`)
    lines.push(`    cpus: ${vm.cpus}`)
    if (vm.isLinux) lines.push("    linux: true")
    if (vm.isWindows) {
      lines.push("    windows:")
      lines.push("      sysprep: false")
    }
    if (domainFqdn && vm.domainRole !== "none") {
      lines.push("    domain:")
      lines.push(`      fqdn: ${domainFqdn}`)
      lines.push(`      role: ${vm.domainRole}`)
    }
    lines.push("    testing:")
    lines.push(`      snapshot: ${vm.testingSnapshot}`)
    lines.push(`      block_internet: ${vm.testingBlockInternet}`)
    lines.push("")
  }
  return lines.join("\n") + buildNetworkYaml(networkRules)
}

export function parseConfigYaml(yamlText: string): VMEntry[] {
  const entries: VMEntry[] = []
  const blocks = yamlText.split(/(?=^\s*- vm_name:)/m)
  for (const block of blocks) {
    const get = (key: string): string => {
      const m = block.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"))
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
    }
    const vmName = get("vm_name")
    if (!vmName) continue
    const template = get("template")
    const { isLinux, isWindows, isServer } = inferOS(template || vmName)
    const rawHostname = get("hostname") || vmName
    const hostnameSuffix = rawHostname.replace(/^\{\{\s*range_id\s*\}\}-/, "")
    entries.push({
      id: newVmEntryId(),
      template: template || vmName,
      vmName,
      hostname: hostnameSuffix.slice(0, isWindows ? 10 : 50),
      vlan: parseInt(get("vlan")) || 10,
      ipLastOctet: parseInt(get("ip_last_octet")) || 10,
      ramGb: parseInt(get("ram_gb")) || 4,
      cpus: parseInt(get("cpus")) || 2,
      isLinux,
      isWindows,
      isServer,
      domainRole: (get("role") as VMEntry["domainRole"]) || "none",
      testingSnapshot: get("snapshot") !== "false",
      testingBlockInternet: get("block_internet") !== "false",
      showAdvanced: false,
    })
  }
  return entries
}
