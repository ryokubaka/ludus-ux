import yaml from "js-yaml"
import { describe, expect, it } from "vitest"
import {
  combineWizardNetworkRules,
  mergeGoadPreviewWithNetworkRules,
  validateGoadConfigYaml,
} from "@/lib/goad-preview-config"
import type { NetworkRule } from "@/lib/network-rules"

const SAMPLE_PREVIEW = `ludus:
  - vm_name: "{{ range_id }}-NEMESIS"
    hostname: "{{ range_id }}-NEMESIS"
    roles:
      - geerlingguy.docker
`

const PREVIEW_WITH_EXTENSION = `${SAMPLE_PREVIEW}
network:
  rules:
    - name: Allow targets to SO Fleet
      vlan_src: 10
      vlan_dst: 20
      protocol: tcp
      ports: "8220,5055,8443"
      action: ACCEPT
`

const EXISTING_RANGE = `ludus: []
network:
  inter_vlan_default: DROP
  rules:
    - name: Allow clients to DC
      vlan_src: 10
      vlan_dst: 10
      protocol: tcp
      ports: "445"
      action: ACCEPT
`

describe("mergeGoadPreviewWithNetworkRules", () => {
  it("returns preview unchanged when no network rules", () => {
    expect(mergeGoadPreviewWithNetworkRules(SAMPLE_PREVIEW, [])).toBe(SAMPLE_PREVIEW)
  })

  it("injects network block when rules provided", () => {
    const rules: NetworkRule[] = [
      {
        name: "allow-443",
        action: "ACCEPT",
        protocol: "tcp",
        ports: "443",
        vlan_src: "public",
        vlan_dst: 10,
      },
    ]
    const merged = mergeGoadPreviewWithNetworkRules(SAMPLE_PREVIEW, rules)
    expect(merged).toContain("network:")
    expect(merged).toContain("allow-443")
  })

  it("lists existing range rules, then extension rules, then wizard rules", () => {
    const rules: NetworkRule[] = [
      {
        name: "allow-443",
        action: "ACCEPT",
        protocol: "tcp",
        ports: "443",
        vlan_src: "public",
        vlan_dst: 10,
      },
    ]
    expect(
      combineWizardNetworkRules(EXISTING_RANGE, PREVIEW_WITH_EXTENSION, rules).map((rule) => rule.name),
    ).toEqual(["Allow clients to DC", "Allow targets to SO Fleet", "allow-443"])
  })

  it("writes that combined list into the generated config", () => {
    const rules: NetworkRule[] = [
      {
        name: "allow-443",
        action: "ACCEPT",
        protocol: "tcp",
        ports: "443",
        vlan_src: "public",
        vlan_dst: 10,
      },
    ]
    const merged = mergeGoadPreviewWithNetworkRules(PREVIEW_WITH_EXTENSION, rules, EXISTING_RANGE)
    const doc = yaml.load(merged) as { network: { inter_vlan_default: string; rules: { name: string }[] } }
    expect(doc.network.inter_vlan_default).toBe("DROP")
    expect(doc.network.rules.map((rule) => rule.name).sort()).toEqual([
      "Allow clients to DC",
      "Allow targets to SO Fleet",
      "allow-443",
    ])
  })

  it("keeps a deleted extension rule out of the generated config once the editor owns the list", () => {
    const rules: NetworkRule[] = [
      {
        name: "Allow clients to DC",
        action: "ACCEPT",
        protocol: "tcp",
        ports: "445",
        vlan_src: 10,
        vlan_dst: 10,
      },
    ]
    const merged = mergeGoadPreviewWithNetworkRules(PREVIEW_WITH_EXTENSION, rules, EXISTING_RANGE, {
      rulesAreComplete: true,
    })
    const doc = yaml.load(merged) as { network: { rules: { name: string }[] } }
    expect(doc.network.rules.map((rule) => rule.name)).toEqual(["Allow clients to DC"])
  })
})

describe("validateGoadConfigYaml", () => {
  it("accepts valid ludus mapping", () => {
    expect(validateGoadConfigYaml(SAMPLE_PREVIEW).valid).toBe(true)
  })

  it("rejects empty yaml", () => {
    const result = validateGoadConfigYaml("   ")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it("rejects invalid yaml syntax", () => {
    const result = validateGoadConfigYaml("ludus:\n  - [broken")
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
