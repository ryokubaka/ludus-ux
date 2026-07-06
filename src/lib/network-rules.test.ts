import { describe, expect, it } from "vitest"
import {
  extractNetworkRules,
  injectNetworkRules,
  extractNetworkSection,
  applyNetworkSection,
  buildNetworkYaml,
  extractVlansFromConfig,
  removeExtensionVmsFromRangeConfig,
  hasNetworkRules,
  networkSnapshotNeedsRedeploy,
  networkSectionEqual,
  blankRule,
  type NetworkRule,
} from "./network-rules"

const SAMPLE_YAML = `
ludus:
  - vm_name: dc01
    hostname: dc01.ludus.domain
    vlan: 10
  - vm_name: ws01
    hostname: ws01.ludus.domain
    vlan: 20
network:
  external_default: REJECT
  rules:
    - name: allow-ssh
      vlan_src: wireguard
      vlan_dst: 10
      protocol: tcp
      ports: "22"
      action: ACCEPT
    - name: allow-rdp
      vlan_src: wireguard
      vlan_dst: 20
      protocol: tcp
      ports: "3389"
      action: ACCEPT
`

describe("extractNetworkRules", () => {
  it("extracts and reverses rules from YAML", () => {
    const rules = extractNetworkRules(SAMPLE_YAML)
    expect(rules).toHaveLength(2)
    expect(rules[0].name).toBe("allow-rdp")
    expect(rules[1].name).toBe("allow-ssh")
  })

  it("returns [] for YAML without network section", () => {
    expect(extractNetworkRules("ludus:\n  - vm_name: dc01\n")).toEqual([])
  })

  it("returns [] for invalid YAML", () => {
    expect(extractNetworkRules("{{{{")).toEqual([])
  })

  it("returns [] for empty string", () => {
    expect(extractNetworkRules("")).toEqual([])
  })

  it("normalizes vlan values correctly", () => {
    const yaml = `
network:
  rules:
    - name: test
      vlan_src: wireguard
      vlan_dst: public
      protocol: all
      ports: all
      action: ACCEPT
`
    const rules = extractNetworkRules(yaml)
    expect(rules[0].vlan_src).toBe("wireguard")
    expect(rules[0].vlan_dst).toBe("public")
  })

  it("normalizes unknown protocol to 'all'", () => {
    const yaml = `
network:
  rules:
    - name: test
      vlan_src: 10
      vlan_dst: 20
      protocol: icmp
      ports: all
      action: ACCEPT
`
    const rules = extractNetworkRules(yaml)
    expect(rules[0].protocol).toBe("all")
  })

  it("normalizes unknown action to ACCEPT", () => {
    const yaml = `
network:
  rules:
    - name: test
      vlan_src: 10
      vlan_dst: 20
      protocol: tcp
      ports: "80"
      action: BLOCK
`
    const rules = extractNetworkRules(yaml)
    expect(rules[0].action).toBe("ACCEPT")
  })

  it("includes ip_last_octet fields when present", () => {
    const yaml = `
network:
  rules:
    - name: test
      vlan_src: 10
      vlan_dst: 20
      ip_last_octet_src: "5"
      ip_last_octet_dst: "10"
      protocol: tcp
      ports: "80"
      action: ACCEPT
`
    const rules = extractNetworkRules(yaml)
    expect(rules[0].ip_last_octet_src).toBe("5")
    expect(rules[0].ip_last_octet_dst).toBe("10")
  })
})

describe("injectNetworkRules", () => {
  it("adds network rules to YAML", () => {
    const base = "ludus:\n  - vm_name: dc01\n"
    const rules: NetworkRule[] = [
      { name: "r1", vlan_src: 10, vlan_dst: "wireguard", protocol: "tcp", ports: "22", action: "ACCEPT" },
    ]
    const result = injectNetworkRules(base, rules)
    expect(result).toContain("network:")
    expect(result).toContain("r1")
  })

  it("removes network section when rules are empty", () => {
    const result = injectNetworkRules(SAMPLE_YAML, [])
    expect(result).not.toContain("network:")
    expect(result).toContain("ludus:")
  })

  it("preserves existing ludus key", () => {
    const result = injectNetworkRules(SAMPLE_YAML, [
      { name: "new", vlan_src: 10, vlan_dst: 20, protocol: "all", ports: "all", action: "ACCEPT" },
    ])
    expect(result).toContain("ludus:")
    expect(result).toContain("dc01")
  })

  it("forces ports to 'all' when protocol is 'all'", () => {
    const result = injectNetworkRules("", [
      { name: "test", vlan_src: 10, vlan_dst: 20, protocol: "all", ports: "80", action: "ACCEPT" },
    ])
    expect(result).toContain('ports: all')
  })
})

describe("extractNetworkSection", () => {
  it("returns the full network object", () => {
    const snap = extractNetworkSection(SAMPLE_YAML)
    expect(snap).not.toBeNull()
    expect(snap!.external_default).toBe("REJECT")
    expect(snap!.rules).toHaveLength(2)
  })

  it("returns null when no network section", () => {
    expect(extractNetworkSection("ludus:\n  - vm_name: dc01\n")).toBeNull()
  })

  it("returns null for invalid YAML", () => {
    expect(extractNetworkSection("{{{{")).toBeNull()
  })

  it("returns null when network is an array", () => {
    expect(extractNetworkSection("network:\n  - item\n")).toBeNull()
  })
})

describe("applyNetworkSection", () => {
  it("replaces network section", () => {
    const result = applyNetworkSection("ludus: []\n", { external_default: "DROP" })
    expect(result).toContain("external_default: DROP")
  })

  it("returns original YAML when network is null", () => {
    const yaml = "ludus: []\n"
    expect(applyNetworkSection(yaml, null)).toBe(yaml)
  })
})

describe("buildNetworkYaml", () => {
  it("returns empty string for no rules", () => {
    expect(buildNetworkYaml([])).toBe("")
  })

  it("builds valid YAML block", () => {
    const rules: NetworkRule[] = [
      { name: "r1", vlan_src: 10, vlan_dst: 20, protocol: "tcp", ports: "22", action: "ACCEPT" },
    ]
    const result = buildNetworkYaml(rules)
    expect(result).toContain("network:")
    expect(result).toContain("rules:")
    expect(result).toContain("r1")
  })
})

describe("extractVlansFromConfig", () => {
  it("extracts unique sorted VLAN numbers", () => {
    expect(extractVlansFromConfig(SAMPLE_YAML)).toEqual([10, 20])
  })

  it("returns [] for YAML without ludus key", () => {
    expect(extractVlansFromConfig("network:\n  rules: []\n")).toEqual([])
  })

  it("returns [] for invalid YAML", () => {
    expect(extractVlansFromConfig("{{{{")).toEqual([])
  })

  it("deduplicates VLANs", () => {
    const yaml = `
ludus:
  - vm_name: a
    vlan: 10
  - vm_name: b
    vlan: 10
  - vm_name: c
    vlan: 20
`
    expect(extractVlansFromConfig(yaml)).toEqual([10, 20])
  })
})

describe("removeExtensionVmsFromRangeConfig", () => {
  const yaml = `
ludus:
  - vm_name: user-range-GOAD-dc01
    vlan: 10
  - vm_name: user-range-GOAD-ws02
    vlan: 20
  - vm_name: user-range-OTHER-srv01
    vlan: 30
`

  it("removes matching VMs by extension name", () => {
    const result = removeExtensionVmsFromRangeConfig(yaml, "ws02")
    expect(result.removed).toContain("user-range-GOAD-ws02")
    expect(result.removed).toHaveLength(1)
  })

  it("returns original YAML when no match", () => {
    const result = removeExtensionVmsFromRangeConfig(yaml, "nonexistent-ext-name")
    expect(result.removed).toHaveLength(0)
    expect(result.yaml).toBe(yaml)
  })

  it("returns original YAML for empty extension name", () => {
    const result = removeExtensionVmsFromRangeConfig(yaml, "")
    expect(result.removed).toHaveLength(0)
  })

  it("returns original YAML for invalid YAML input", () => {
    const result = removeExtensionVmsFromRangeConfig("- [invalid", "ws02")
    expect(result.removed).toHaveLength(0)
  })
})

describe("hasNetworkRules", () => {
  it("returns true when rules exist", () => {
    expect(hasNetworkRules({ rules: [{ name: "r", vlan_src: 10, vlan_dst: 20, protocol: "tcp", ports: "22", action: "ACCEPT" }] })).toBe(true)
  })

  it("returns false for null snapshot", () => {
    expect(hasNetworkRules(null)).toBe(false)
  })

  it("returns false for empty rules", () => {
    expect(hasNetworkRules({ rules: [] })).toBe(false)
  })

  it("returns false when rules is undefined", () => {
    expect(hasNetworkRules({})).toBe(false)
  })
})

describe("networkSnapshotNeedsRedeploy", () => {
  it("returns true when rules exist", () => {
    expect(networkSnapshotNeedsRedeploy({ rules: [{ name: "r", vlan_src: 10, vlan_dst: 20, protocol: "tcp", ports: "22", action: "ACCEPT" }] })).toBe(true)
  })

  it("returns true when other keys exist", () => {
    expect(networkSnapshotNeedsRedeploy({ external_default: "REJECT" })).toBe(true)
  })

  it("returns false for null", () => {
    expect(networkSnapshotNeedsRedeploy(null)).toBe(false)
  })
})

describe("networkSectionEqual", () => {
  it("returns true for matching sections", () => {
    const snap = extractNetworkSection(SAMPLE_YAML)
    expect(networkSectionEqual(SAMPLE_YAML, snap!)).toBe(true)
  })

  it("returns false when network differs", () => {
    const snap = { external_default: "DROP" as const }
    expect(networkSectionEqual(SAMPLE_YAML, snap)).toBe(false)
  })

  it("returns false for invalid YAML", () => {
    expect(networkSectionEqual("{{", { external_default: "DROP" })).toBe(false)
  })
})

describe("blankRule", () => {
  it("returns a default NetworkRule", () => {
    const rule = blankRule()
    expect(rule.name).toBe("")
    expect(rule.vlan_src).toBe(10)
    expect(rule.vlan_dst).toBe("wireguard")
    expect(rule.protocol).toBe("all")
    expect(rule.ports).toBe("all")
    expect(rule.action).toBe("ACCEPT")
  })
})
