import type { NetworkRule, VlanValue } from "@/lib/range/network-rules"
import { endpointNodeId, vlanNodeId } from "./builder-types"

export interface FirewallEndVm {
  id: string
  vlan: number
  ipLastOctet: number
}

/**
 * Nodes a firewall rule should connect.
 * A last octet that matches one machine on that subnet connects the machine.
 * Anything else connects the subnet. A rule whose ends are the same node is not drawn.
 */
export function firewallRuleEnds(
  rule: NetworkRule,
  vms: readonly FirewallEndVm[],
): { source: string; target: string } | null {
  const source = firewallEndNode(rule.vlan_src, rule.ip_last_octet_src, vms)
  const target = firewallEndNode(rule.vlan_dst, rule.ip_last_octet_dst, vms)
  if (!source || !target || source === target) return null
  return { source, target }
}

function firewallEndNode(
  vlan: VlanValue,
  octet: string | undefined,
  vms: readonly FirewallEndVm[],
): string | null {
  if (typeof vlan === "number") {
    const host = hostNode(vlan, octet, vms)
    if (host) return host
    return vlanNodeId(vlan)
  }
  if (vlan === "wireguard" || vlan === "public") return endpointNodeId(vlan)
  return null
}

function hostNode(vlan: number, octet: string | undefined, vms: readonly FirewallEndVm[]): string | null {
  if (!octet || !/^\d{1,3}$/.test(octet)) return null
  const n = Number(octet)
  const matches = vms.filter((vm) => vm.vlan === vlan && vm.ipLastOctet === n)
  return matches.length === 1 ? matches[0].id : null
}
