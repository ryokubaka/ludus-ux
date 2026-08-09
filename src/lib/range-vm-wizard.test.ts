import { describe, expect, it } from "vitest"
import {
  appendVmsToRangeConfig,
  collectIpLastOctetsByVlan,
  defaultsForTemplate,
  suggestIpLastOctetForVlan,
} from "./range-vm-wizard"

const BASE_YAML = `
network:
  inter_vlan_default: DROP
ludus:
  - vm_name: "{{ range_id }}-kali"
    hostname: "{{ range_id }}-kali"
    template: kali-x64-desktop-template
    vlan: 10
    ip_last_octet: 10
    ram_gb: 4
    cpus: 2
    linux: true
    testing:
      snapshot: true
      block_internet: true
`

describe("appendVmsToRangeConfig", () => {
  it("appends new ludus entries while preserving network block", () => {
    const vm = defaultsForTemplate("debian-12-x64-server-template", { vlan: 10, ipLastOctet: 11 })
    const merged = appendVmsToRangeConfig(BASE_YAML, [vm])
    expect(merged).toContain("kali-x64-desktop-template")
    expect(merged).toContain("debian-12-x64-server-template")
    expect(merged).toContain("inter_vlan_default: DROP")
  })
})

describe("suggestIpLastOctetForVlan", () => {
  it("skips octets already used on the vlan", () => {
    expect(suggestIpLastOctetForVlan(BASE_YAML, 10)).toBe(11)
  })
})

describe("collectIpLastOctetsByVlan", () => {
  it("indexes used octets per vlan", () => {
    const map = collectIpLastOctetsByVlan(BASE_YAML)
    expect(map.get(10)?.has(10)).toBe(true)
  })
})
