import { describe, expect, it } from "vitest"
import { defaultVmRows, domainJoinWarnings, nextRule, nextVmRow, parseRangeVms, scratchRangeYaml, templatesForRole, validateDomain, validateNetworks, validateRangeVms, validateRules, validateVlan } from "@/lib/luxai/range-vms"

const templates = [
  { id: "win2022-server-x64-template", os: "windows" },
  { id: "debian-12-x64-server-template", os: "linux" },
]

describe("from-scratch range VMs", () => {
  it("starts with a primary domain controller on a Windows template", () => {
    expect(defaultVmRows(templates)).toEqual([
      { hostname: "dc01", role: "primary-dc", template: "win2022-server-x64-template", vlan: "10" },
    ])
  })

  it("adds the next VM as a domain member and allows another primary domain", () => {
    const rows = [...defaultVmRows(templates), nextVmRow(defaultVmRows(templates), templates)]
    expect(rows[1]).toMatchObject({ hostname: "srv01", role: "member", template: "win2022-server-x64-template" })
    expect(validateRangeVms(rows, templates)).toBe("")
    const two = rows.map((row) => ({ ...row, role: "primary-dc" as const, template: "win2022-server-x64-template" }))
    expect(validateRangeVms(two, templates)).toBe("")
    expect(validateDomain("", two)).toMatch(/domain name/)
    const named = two.map((row, index) => ({ ...row, domain: index === 0 ? "meow.local" : "bark.local" }))
    expect(validateDomain("", named)).toBe("")
    expect(validateDomain("", named.map((row) => ({ ...row, domain: "meow.local" })))).toMatch(/own domain/)
  })

  it("rejects a hostname typed into the template and a domain that is not a FQDN", () => {
    const rows = [{ hostname: "dc01", role: "primary-dc", template: "srv01", vlan: "10" }]
    expect(validateRangeVms(rows, templates)).toMatch(/template/)
    expect(validateDomain("meow", rows)).toMatch(/meow.local/)
    expect(validateDomain("meow.local", rows)).toBe("")
    expect(validateVlan("10")).toBe("")
    expect(validateVlan("2")).toBe("")
    expect(validateVlan("1")).toMatch(/255/)
    expect(validateVlan("0")).toMatch(/255/)
    expect(validateVlan("256")).toMatch(/255/)
  })

  it("keeps a router on a Linux template", () => {
    const rows = [{ hostname: "router", role: "router", template: "debian-12-x64-server-template", vlan: "10" }]
    expect(validateRangeVms(rows, templates)).toBe("")
    expect(validateDomain("", rows)).toBe("")
    expect(parseRangeVms(JSON.stringify(rows))).toEqual(rows)
  })

  it("allows more than one network and checks firewall rules against them", () => {
    const networks = [{ vlan: "10" }, { vlan: "20" }]
    expect(validateNetworks(networks)).toBe("")
    expect(validateNetworks([{ vlan: "10" }, { vlan: "10" }])).toMatch(/more than once/)
    const rows = [{ hostname: "dc01", role: "primary-dc", template: "win2022-server-x64-template", vlan: "20" }]
    expect(validateRangeVms(rows, templates, networks)).toBe("")
    const rule = { ...nextRule(networks), name: "allow-https", protocol: "tcp", ports: "443" }
    expect(validateRules([rule], networks)).toBe("")
    expect(validateRules([{ ...rule, ports: "8080:8088" }], networks)).toBe("")
    expect(validateRules([{ ...nextRule(networks), name: "allow-all" }], networks)).toBe("")
    expect(validateRules([{ ...rule, vlanSrc: "30" }], networks)).toMatch(/not one of the networks/)
    expect(validateRules([{ ...rule, vlanSrc: "all" }], [])).toBe("")
    expect(validateVlan("20")).toBe("")
  })

  it("leaves a workstation off the domain until the person joins it", () => {
    const rows = [
      { hostname: "dc01", role: "primary-dc", template: "win2022-server-x64-template", vlan: "10" },
      { hostname: "ws01", role: "workstation", template: "win2022-server-x64-template", vlan: "21" },
    ]
    expect(validateDomain("meow.local", rows)).toBe("")
    expect(validateDomain("", [rows[1]])).toBe("")
    expect(validateDomain("", [{ ...rows[1], domainJoin: true }])).toMatch(/Domain FQDN/)
    expect(validateDomain("meow.local", rows.map((row) => row.hostname === "ws01" ? { ...row, domainJoin: true } : row))).toBe("")
    expect(parseRangeVms(JSON.stringify(rows.map((row) => row.hostname === "ws01" ? { ...row, domainJoin: true } : row))))
      .toEqual(rows.map((row) => row.hostname === "ws01" ? { ...row, domainJoin: true } : row))
  })

  it("warns when a joined VM is on another VLAN and the rules do not open that path", () => {
    const rows = [
      { hostname: "dc01", role: "primary-dc", template: "win2022-server-x64-template", vlan: "10" },
      { hostname: "ws01", role: "workstation", template: "win2022-server-x64-template", vlan: "21", domainJoin: true },
    ]
    const wireguard = { ...nextRule([{ vlan: "10" }]), name: "to-wg" }
    const warnings = domainJoinWarnings(rows, [wireguard])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/VLAN 21/)
    expect(warnings[0]).toMatch(/VLAN 10/)
    expect(warnings[0]).toMatch(/may fail/)
    expect(domainJoinWarnings(rows, [])[0]).toMatch(/may fail/)
    expect(domainJoinWarnings(rows.map((row) => ({ ...row, domainJoin: false })), [wireguard])).toEqual([])
    expect(domainJoinWarnings(rows.map((row) => ({ ...row, vlan: "10" })), [])).toEqual([])
    const bothWays = [
      { ...wireguard, name: "to-dc", vlanSrc: "21", vlanDst: "10", protocol: "all", ports: "all", action: "ACCEPT" },
      { ...wireguard, name: "from-dc", vlanSrc: "10", vlanDst: "21", protocol: "all", ports: "all", action: "ACCEPT" },
    ]
    expect(domainJoinWarnings(rows, bothWays)).toEqual([])
  })

  it("keeps workstation templates off a domain controller and writes one domain per primary", () => {
    const list = [
      { id: "win2022-server-x64-template", os: "windows" },
      { id: "win11-25h2-x64-enterprise-template", os: "windows" },
      { id: "debian-12-x64-server-template", os: "linux" },
    ]
    expect(templatesForRole("primary-dc", list).map((item) => item.id)).toEqual(["win2022-server-x64-template"])
    expect(templatesForRole("workstation", list).map((item) => item.id)).toEqual(["win11-25h2-x64-enterprise-template"])
    expect(templatesForRole("router", list).map((item) => item.id)).toEqual(["debian-12-x64-server-template"])
    const rows = [
      { hostname: "dc01", role: "primary-dc", template: "win2022-server-x64-template", vlan: "10", domain: "meow.local" },
      { hostname: "dc02", role: "primary-dc", template: "win2022-server-x64-template", vlan: "21", domain: "bark.local" },
      { hostname: "ws01", role: "workstation", template: "win11-25h2-x64-enterprise-template", vlan: "21", domain: "bark.local", domainJoin: true },
      { hostname: "ws02", role: "workstation", template: "win11-25h2-x64-enterprise-template", vlan: "10" },
      { hostname: "router", role: "router", template: "debian-12-x64-server-template", vlan: "10" },
    ]
    expect(validateRangeVms(rows, list)).toBe("")
    expect(validateDomain("", rows)).toBe("")
    expect(domainJoinWarnings(rows, [])).toEqual([])
    const yaml = scratchRangeYaml(rows, [
      { name: "first", vlanSrc: "10", vlanDst: "21", protocol: "all", ports: "all", action: "ACCEPT" },
      { name: "second", vlanSrc: "21", vlanDst: "10", protocol: "all", ports: "all", action: "ACCEPT" },
    ], "")
    expect(yaml).toContain("fqdn: meow.local")
    expect(yaml).toContain("fqdn: bark.local")
    expect(yaml).toContain("sysprep: false")
    expect(yaml).toContain("linux: true")
    expect(yaml).toContain('vm_name: "{{ range_id }}-dc01"')
    expect(yaml).toMatch(/hostname: dc01\b/)
    expect(yaml).not.toMatch(/hostname: "?\{\{ range_id \}\}-dc01/)
    expect(yaml).toContain("hostname: router")
    expect(yaml).toContain('vm_name: "{{ range_id }}-router"')
    expect(yaml.indexOf("name: second")).toBeLessThan(yaml.indexOf("name: first"))
    expect(yaml).toMatch(/vlan_src: 10\b/)
    expect(yaml).not.toMatch(/vlan_src:\s*["']10["']/)
    const unjoined = yaml.split("- vm_name:").find((part) => part.includes("ws02")) ?? ""
    expect(unjoined).not.toContain("domain:")
  })

  it("writes firewall rules in the range config schema form", () => {
    const rows = [{ hostname: "dc01", role: "primary-dc", template: "win2022-server-x64-template", vlan: "10", domain: "meow.local" }]
    const yaml = scratchRangeYaml(rows, [
      { name: "web", vlanSrc: "10", vlanDst: "wireguard", protocol: "tcp", ports: "443", action: "ACCEPT", ipLastOctetSrc: "21" },
      { name: "span", vlanSrc: "10", vlanDst: "21", protocol: "tcp", ports: "8080-8088", action: "ACCEPT" },
    ], "meow.local")
    expect(yaml).toMatch(/vlan_src: 10\b/)
    expect(yaml).not.toMatch(/vlan_src:\s*["']/)
    expect(yaml).toContain("vlan_dst: wireguard")
    expect(yaml).toMatch(/ip_last_octet_src: 21\b/)
    expect(yaml).not.toMatch(/ip_last_octet_src:\s*["']21["']/)
    expect(yaml).toContain("8080:8088")
    expect(yaml).not.toContain("8080-8088")
  })
})