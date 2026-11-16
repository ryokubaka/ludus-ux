import { describe, expect, it } from "vitest"
import { firewallRuleEnds } from "./firewall-rule-ends"
import type { NetworkRule } from "@/lib/range/network-rules"

const vms = [
  { id: "dc", vlan: 10, ipLastOctet: 10 },
  { id: "ws", vlan: 10, ipLastOctet: 20 },
  { id: "other", vlan: 20, ipLastOctet: 10 },
]

function rule(patch: Partial<NetworkRule>): NetworkRule {
  return {
    name: "rule",
    vlan_src: 10,
    vlan_dst: 10,
    protocol: "all",
    ports: "all",
    action: "ACCEPT",
    ...patch,
  }
}

describe("firewallRuleEnds", () => {
  it("draws a same-subnet host rule between the machines", () => {
    expect(
      firewallRuleEnds(rule({ ip_last_octet_src: "10", ip_last_octet_dst: "20" }), vms),
    ).toEqual({ source: "dc", target: "ws" })
  })

  it("draws a subnet rule between the VLAN boxes", () => {
    expect(firewallRuleEnds(rule({ vlan_dst: 20 }), vms)).toEqual({
      source: "vlan:10",
      target: "vlan:20",
    })
  })

  it("does not draw a rule that starts and ends on the same node", () => {
    expect(firewallRuleEnds(rule({}), vms)).toBeNull()
  })
})
