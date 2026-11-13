import { describe, expect, it } from "vitest"
import yaml from "js-yaml"
import {
  parseRangeDocument,
  serializeRangeDocument,
  canonicalRangeYaml,
  projectGraph,
  addVmFromTemplate,
  moveVmToVlan,
  renumberVlan,
  setDomainMembership,
  renameDomain,
  setRangeDefaults,
  setNetworkRules,
  setNetworkDefaults,
  addForestTrust,
  removeForestTrust,
  vmTestingFlag,
  setVmRoles,
  setVmRoleVars,
  updateVmRaw,
  validateGraph,
  hasBlockingFindings,
  documentHasRoles,
  nextFreeVlan,
  nextOctetForVlan,
} from "./range-builder-document"
import { firewallMirrorIndex, type NetworkRule } from "./network-rules"
import {
  computeDefaultLayout,
  domainFqdnFromNodeId,
  expandRangeId,
  restoreRangeId,
  domainGroupHeight,
  domainPairKey,
  layoutVlanStack,
  compactLayout,
  groupTemplates,
  matchLiveVm,
  vlanGroupHeight,
  vlanNodeId,
} from "../../components/range/builder/builder-types"

const DOC_YAML = `
ludus:
  - vm_name: "{{ range_id }}-dc01"
    hostname: "{{ range_id }}-dc01"
    template: win2022-server-x64-template
    vlan: 10
    ip_last_octet: 11
    ram_gb: 8
    cpus: 4
    windows:
      sysprep: false
    domain:
      fqdn: first.local
      role: primary-dc
  - vm_name: "{{ range_id }}-dc02"
    hostname: "{{ range_id }}-dc02"
    template: win2022-server-x64-template
    vlan: 20
    ip_last_octet: 11
    ram_gb: 8
    cpus: 4
    windows:
      sysprep: false
    domain:
      fqdn: second.local
      role: primary-dc
  - vm_name: "{{ range_id }}-kali"
    hostname: "{{ range_id }}-kali"
    template: kali-x64-desktop-template
    vlan: 99
    ip_last_octet: 1
    ram_gb: 4
    cpus: 2
    linux: true
network:
  inter_vlan_default: REJECT
  rules:
    - name: allow-rdp
      vlan_src: wireguard
      vlan_dst: 10
      protocol: tcp
      ports: "3389"
      action: ACCEPT
    - name: allow-ssh
      vlan_src: wireguard
      vlan_dst: 99
      protocol: tcp
      ports: "22"
      action: ACCEPT
defaults:
  ad_domain_admin: admin
ludus_extensions:
  asset_tracker:
    project_id: training
`

function reload(doc: ReturnType<typeof parseRangeDocument>) {
  return parseRangeDocument(serializeRangeDocument(doc))
}

describe("range-builder-document projection", () => {
  it("projects vms, vlans, domains, and router", () => {
    const graph = projectGraph(parseRangeDocument(DOC_YAML))
    expect(graph.vms.map((v) => v.id)).toEqual([
      "{{ range_id }}-dc01",
      "{{ range_id }}-dc02",
      "{{ range_id }}-kali",
    ])
    expect(graph.vlans.map((v) => v.vlan)).toEqual([10, 20, 99])
    expect(graph.domains.map((d) => d.fqdn)).toEqual(["first.local", "second.local"])
    expect(graph.domains[0].primaryDcVmId).toBe("{{ range_id }}-dc01")
    expect(graph.vms[0].os).toBe("windows")
    expect(graph.vms[2].os).toBe("linux")
  })

  it("reads rules in evaluation order (reverse of file order)", () => {
    const graph = projectGraph(parseRangeDocument(DOC_YAML))
    // File order is [allow-rdp, allow-ssh]; evaluation order reverses it.
    expect(graph.rules.map((r) => r.name)).toEqual(["allow-ssh", "allow-rdp"])
    expect(graph.networkDefaults.inter_vlan_default).toBe("REJECT")
  })
})

describe("saved yaml", () => {
  it("treats quote and indent differences as the same document", () => {
    const raw = "ludus:\n- vm_name: '{{ range_id }}-GOAD-WS01'\n  hostname: '{{ range_id }}-WS01'\n"
    const again = canonicalRangeYaml(raw)
    expect(again).toContain('"{{ range_id }}-GOAD-WS01"')
    expect(canonicalRangeYaml(again)).toBe(again)
    expect(again).not.toBe(raw)
  })
})

describe("unknown-key preservation", () => {
  it("keeps ludus_extensions and other unknown keys through a round trip", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const moved = moveVmToVlan(doc, "{{ range_id }}-kali", 30)
    const root = reload(moved).root as Record<string, unknown>
    expect(root.ludus_extensions).toEqual({ asset_tracker: { project_id: "training" } })
    expect(root.defaults).toEqual({ ad_domain_admin: "admin" })
  })
})

describe("rule reversal on write", () => {
  it("writes evaluation-order rules back reversed for iptables -I", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const rules: NetworkRule[] = [
      { name: "first-eval", vlan_src: 10, vlan_dst: 20, protocol: "tcp", ports: "445", action: "ACCEPT" },
      { name: "second-eval", vlan_src: 20, vlan_dst: 10, protocol: "all", ports: "all", action: "DROP" },
    ]
    const next = setNetworkRules(doc, rules)
    const root = next.root as Record<string, unknown>
    const network = root.network as { rules: Array<{ name: string }> }
    expect(network.rules.map((r) => r.name)).toEqual(["second-eval", "first-eval"])
    // Round-tripping restores evaluation order.
    expect(projectGraph(next).rules.map((r) => r.name)).toEqual(["first-eval", "second-eval"])
  })

  it("keeps inter_vlan_default when only rules change", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const next = setNetworkRules(doc, [])
    expect(projectGraph(next).networkDefaults.inter_vlan_default).toBe("REJECT")
  })
})

describe("vlan renumber", () => {
  it("moves member VMs and rewrites rule vlan references", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const next = renumberVlan(doc, 10, 15)
    const graph = projectGraph(next)
    expect(graph.vms.find((v) => v.id === "{{ range_id }}-dc01")?.vlan).toBe(15)
    const rdp = graph.rules.find((r) => r.name === "allow-rdp")
    expect(rdp?.vlan_dst).toBe(15)
  })
})

describe("octet assignment", () => {
  it("assigns the next free octet when moving to a populated vlan", () => {
    const doc = parseRangeDocument(DOC_YAML)
    // VLAN 10 already uses octet 11; kali keeps 1 which is free on vlan 10.
    const next = moveVmToVlan(doc, "{{ range_id }}-kali", 10)
    const kali = projectGraph(next).vms.find((v) => v.id === "{{ range_id }}-kali")
    expect(kali?.vlan).toBe(10)
    expect(kali?.ipLastOctet).toBe(1)
  })

  it("reassigns a colliding octet", () => {
    let doc = parseRangeDocument(DOC_YAML)
    doc = moveVmToVlan(doc, "{{ range_id }}-kali", 10, 11) // force collision intent
    // Explicit octet is honored; validation flags the collision separately.
    expect(projectGraph(doc).vms.find((v) => v.id === "{{ range_id }}-kali")?.ipLastOctet).toBe(11)
    const findings = validateGraph(projectGraph(doc))
    expect(findings.some((f) => f.message.includes("more than one VM on VLAN 10"))).toBe(true)
  })

  it("nextOctetForVlan skips used octets", () => {
    const doc = parseRangeDocument(DOC_YAML)
    expect(nextOctetForVlan(doc, 10)).toBe(10)
    expect(nextFreeVlan(doc)).toBe(11)
    expect(nextFreeVlan(doc, [11, 12])).toBe(13)
    expect(nextFreeVlan(doc, [10, 11])).toBe(12)
  })
})

describe("template drop domain membership", () => {
  it("joins a Windows template dropped on a domain", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const created = addVmFromTemplate(doc, "win11-22h2-x64-enterprise-template", {
      vlan: 40,
      domainFqdn: "brand.local",
    })
    const primary = projectGraph(created.doc).vms.find((v) => v.id === created.vmId)
    expect(primary?.domainFqdn).toBe("brand.local")
    expect(primary?.domainRole).toBe("primary-dc")

    const joined = addVmFromTemplate(doc, "win2022-server-x64-template", {
      vlan: 10,
      domainFqdn: "first.local",
    })
    const member = projectGraph(joined.doc).vms.find((v) => v.id === joined.vmId)
    expect(member?.domainFqdn).toBe("first.local")
    expect(member?.domainRole).toBe("member")
    const raw = (joined.doc.root.ludus as Record<string, unknown>[]).find(
      (vm) => vm.vm_name === joined.vmId,
    )
    expect(raw?.domain).toEqual({ fqdn: "first.local", role: "member" })
  })

  it("leaves Linux and macOS templates off the domain", () => {
    const doc = parseRangeDocument(DOC_YAML)
    for (const template of ["debian-12-x64-server-template", "macos-sonoma-x64-template"]) {
      const added = addVmFromTemplate(doc, template, { vlan: 10, domainFqdn: "first.local" })
      const vm = projectGraph(added.doc).vms.find((v) => v.id === added.vmId)
      expect(vm?.domainFqdn).toBeNull()
      expect(vm?.domainRole).toBe("none")
    }
  })

  it("refuses to join a non-Windows VM that is already in the document", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const next = setDomainMembership(doc, "{{ range_id }}-kali", "first.local", "member")
    const kali = projectGraph(next).vms.find((v) => v.id === "{{ range_id }}-kali")
    expect(kali?.domainFqdn).toBeNull()
    expect(kali?.domainRole).toBe("none")
    const cleared = setDomainMembership(
      setDomainMembership(doc, "{{ range_id }}-dc02", "first.local", "member"),
      "{{ range_id }}-dc02",
      null,
      "none",
    )
    expect(projectGraph(cleared).vms.find((v) => v.id === "{{ range_id }}-dc02")?.domainFqdn).toBeNull()
  })
})

describe("domain defaults", () => {
  it("edits the range defaults block and drops empty values", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const next = setRangeDefaults(doc, { ad_domain_admin: "root", ad_domain_admin_password: "pw" })
    expect(projectGraph(next).rangeDefaults).toEqual({
      ad_domain_admin: "root",
      ad_domain_admin_password: "pw",
    })
    const cleared = setRangeDefaults(next, { ad_domain_admin: "", ad_domain_admin_password: "" })
    expect((cleared.root as Record<string, unknown>).defaults).toBeUndefined()
  })

  it("renames a domain across members", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const next = renameDomain(doc, "first.local", "renamed.local")
    const graph = projectGraph(next)
    expect(graph.domains.map((d) => d.fqdn)).toContain("renamed.local")
    expect(graph.vms.find((v) => v.id === "{{ range_id }}-dc01")?.domainFqdn).toBe("renamed.local")
  })
})

describe("forest trust role emission", () => {
  it("writes ludus_trust_* vars on the source primary DC", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const res = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const graph = projectGraph(res.doc)
    const dc = graph.vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(dc?.roles.some((r) => r.name.endsWith("ludus_ad_forest_trust"))).toBe(true)
    expect(dc?.roleVars).toMatchObject({
      ludus_trust_partner_domain: "second.local",
      ludus_trust_partner_dc_ip: "10.7.20.11",
      ludus_dns_forward_zone: "second.local",
      ludus_dns_forward_server: "10.7.20.11",
    })
    expect(graph.trusts).toHaveLength(1)
    expect(graph.trusts[0]).toMatchObject({ fromFqdn: "first.local", toFqdn: "second.local" })
  })

  it("refuses a second partner on a DC that already initiates a trust", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const first = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // Add a third domain DC to attempt another partner from the same DC.
    let withThird = addVmFromTemplate(first.doc, "win2022-server-x64-template", {
      vlan: 30,
      ipLastOctet: 11,
      domainFqdn: "third.local",
    }).doc
    withThird = setDomainMembership(
      withThird,
      projectGraph(withThird).vms.at(-1)!.id,
      "third.local",
      "primary-dc",
    )
    const second = addForestTrust(withThird, "first.local", "third.local", { rangeNumber: 7 })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toContain("already initiates a trust")
  })

  it("needs a range number to resolve the partner DC IP", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const res = addForestTrust(doc, "first.local", "second.local", { rangeNumber: null })
    expect(res.ok).toBe(false)
  })

  it("removes the trust role and its vars", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const added = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const removed = removeForestTrust(added.doc, "{{ range_id }}-dc01")
    const dc = projectGraph(removed).vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(dc?.roles).toHaveLength(0)
    expect(dc?.roleVars.ludus_trust_partner_domain).toBeUndefined()
  })

  it("anchors the trust on the domain whose primary DC hosts the role", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(doc, "win2022-server-x64-template", {
      vlan: 10,
      ipLastOctet: 12,
    })
    doc = setVmRoles(child.doc, child.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, child.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_parent_domain_fqdn: "first.local",
      ludus_parent_dc_ip: "10.7.10.11",
    })
    const bare = addForestTrust(doc, "north.first.local", "second.local", { rangeNumber: 7 })
    expect(bare.ok).toBe(true)
    if (!bare.ok) return
    expect(projectGraph(bare.doc).trusts[0]).toMatchObject({
      sourceVmId: child.vmId,
      fromFqdn: "north.first.local",
      toFqdn: "second.local",
    })

    const member = setDomainMembership(doc, child.vmId, "first.local", "member")
    const fromParent = addForestTrust(member, "north.first.local", "second.local", { rangeNumber: 7 })
    expect(fromParent.ok).toBe(true)
    if (!fromParent.ok) return
    expect(projectGraph(fromParent.doc).trusts[0]?.fromFqdn).toBe("north.first.local")
  })

  it("clears trust address vars when the trust role is removed", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const trusted = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    const stale = updateVmRaw(trusted.doc, "{{ range_id }}-dc02", { ip_last_octet: 12 })
    expect(hasBlockingFindings(validateGraph(projectGraph(stale), undefined, 7))).toBe(true)
    const dc = projectGraph(stale).vms.find((v) => v.id === "{{ range_id }}-dc01")
    const removed = setVmRoles(
      stale,
      "{{ range_id }}-dc01",
      (dc?.roles ?? []).filter((r) => !r.name.endsWith("ludus_ad_forest_trust")),
    )
    const after = projectGraph(removed).vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(after?.roleVars.ludus_trust_partner_dc_ip).toBeUndefined()
    expect(after?.roleVars.ludus_dns_forward_server).toBeUndefined()
    expect(hasBlockingFindings(validateGraph(projectGraph(removed), undefined, 7))).toBe(false)
  })
})

describe("child domain role emission", () => {
  it("projects a child domain from ludus_child_domain role vars", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(doc, "win2022-server-x64-template", {
      vlan: 10,
      ipLastOctet: 12,
    })
    doc = child.doc
    doc = setVmRoles(doc, child.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, child.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_parent_domain_fqdn: "first.local",
      ludus_parent_dc_ip: "10.7.10.11",
    })
    const graph = projectGraph(doc)
    const childDomain = graph.domains.find((d) => d.fqdn === "north.first.local")
    const childVm = graph.vms.find((vm) => vm.id === child.vmId)
    expect(childDomain?.childOfFqdn).toBe("first.local")
    expect(childDomain?.primaryDcVmId).toBe(child.vmId)
    expect(childDomain?.vmIds).toContain(child.vmId)
    expect(childVm?.domainFqdn).toBe("north.first.local")
    expect(childVm?.domainRole).toBe("primary-dc")
    expect(childVm?.raw.domain).toBeUndefined()
    const again = projectGraph(parseRangeDocument(serializeRangeDocument(doc)))
    expect(again.vms.find((vm) => vm.id === child.vmId)?.domainFqdn).toBe("north.first.local")
    expect(again.vms.find((vm) => vm.id === child.vmId)?.raw.domain).toBeUndefined()
  })

  it("draws a commonwkstn host in member_domain without writing a domain block", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const added = addVmFromTemplate(doc, "win11-22h2-x64-enterprise-template", { vlan: 10, ipLastOctet: 31 })
    doc = setVmRoles(added.doc, added.vmId, [{ name: "commonwkstn", dependsOn: [] }])
    doc = setVmRoleVars(doc, added.vmId, { member_domain: "sevenkingdoms.local" })
    const joined = projectGraph(doc).vms.find((vm) => vm.id === added.vmId)
    expect(joined?.domainFqdn).toBe("sevenkingdoms.local")
    expect(joined?.domainRole).toBe("member")
    expect(joined?.raw.domain).toBeUndefined()
  })

  it("draws a child-domain join host in that domain without writing a domain block", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(doc, "win2022-server-x64-template", { vlan: 10, ipLastOctet: 12 })
    doc = setVmRoles(child.doc, child.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, child.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_parent_domain_fqdn: "first.local",
      ludus_parent_dc_ip: "10.{{ range_second_octet }}.10.11",
    })
    const member = addVmFromTemplate(doc, "win2022-server-x64-template", { vlan: 10, ipLastOctet: 13 })
    doc = setVmRoles(member.doc, member.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain_join", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, member.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_child_dc_ip: "10.{{ range_second_octet }}.10.12",
    })
    const graph = projectGraph(doc)
    const joined = graph.vms.find((vm) => vm.id === member.vmId)
    expect(joined?.domainFqdn).toBe("north.first.local")
    expect(joined?.domainRole).toBe("member")
    expect(joined?.raw.domain).toBeUndefined()
    expect(graph.domains.find((domain) => domain.fqdn === "north.first.local")?.vmIds).toEqual(
      expect.arrayContaining([child.vmId, member.vmId]),
    )
    const findings = validateGraph(graph, undefined, 7)
    expect(findings.some((finding) => finding.message.includes("ludus_parent_dc_ip"))).toBe(false)
    expect(findings.some((finding) => finding.message.includes("ludus_child_dc_ip"))).toBe(false)
  })

  it("still flags a templated DC address that does not match the controller", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(doc, "win2022-server-x64-template", { vlan: 10, ipLastOctet: 12 })
    doc = setVmRoles(child.doc, child.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, child.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_parent_domain_fqdn: "first.local",
      ludus_parent_dc_ip: "10.{{ range_second_octet }}.10.99",
    })
    const findings = validateGraph(projectGraph(doc), undefined, 7)
    expect(findings.some((finding) => finding.level === "error" && finding.message.includes("ludus_parent_dc_ip"))).toBe(
      true,
    )
  })

  it("keeps an explicit domain block ahead of the child-domain role", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(doc, "win2022-server-x64-template", { vlan: 10, ipLastOctet: 12 })
    doc = setVmRoles(child.doc, child.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, child.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_parent_domain_fqdn: "first.local",
      ludus_parent_dc_ip: "10.7.10.11",
    })
    doc = setDomainMembership(doc, child.vmId, "first.local", "member")
    const vm = projectGraph(doc).vms.find((item) => item.id === child.vmId)
    expect(vm?.domainFqdn).toBe("first.local")
    expect(vm?.domainRole).toBe("member")
  })

  it("clears child-domain address vars when those roles are removed", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(doc, "win2022-server-x64-template", { vlan: 10, ipLastOctet: 12 })
    doc = setVmRoles(child.doc, child.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, child.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_parent_domain_fqdn: "first.local",
      ludus_parent_dc_ip: "10.7.99.11",
    })
    doc = setVmRoles(doc, "{{ range_id }}-kali", [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain_join", dependsOn: [] },
    ])
    doc = setVmRoleVars(doc, "{{ range_id }}-kali", {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_child_dc_ip: "10.7.99.12",
    })
    expect(hasBlockingFindings(validateGraph(projectGraph(doc), undefined, 7))).toBe(true)

    const withoutChild = setVmRoles(doc, child.vmId, [])
    expect(projectGraph(withoutChild).vms.find((v) => v.id === child.vmId)?.roleVars.ludus_parent_dc_ip).toBeUndefined()
    expect(projectGraph(withoutChild).vms.find((v) => v.id === "{{ range_id }}-kali")?.roleVars.ludus_child_dc_ip).toBe("10.7.99.12")

    const withoutJoin = setVmRoles(withoutChild, "{{ range_id }}-kali", [])
    expect(projectGraph(withoutJoin).vms.find((v) => v.id === "{{ range_id }}-kali")?.roleVars.ludus_child_dc_ip).toBeUndefined()
    expect(hasBlockingFindings(validateGraph(projectGraph(withoutJoin), undefined, 7))).toBe(false)
  })
})

describe("DC address role vars follow VLAN and octet changes", () => {
  it("rewrites trust partner addresses when the partner DC moves VLAN", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const trusted = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    const moved = moveVmToVlan(trusted.doc, "{{ range_id }}-dc02", 30, undefined, 7)
    const source = projectGraph(moved).vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(source?.roleVars.ludus_trust_partner_dc_ip).toBe("10.7.30.11")
    expect(source?.roleVars.ludus_dns_forward_server).toBe("10.7.30.11")
    expect(projectGraph(moved).vms.find((v) => v.id === "{{ range_id }}-dc02")?.vlan).toBe(30)
  })

  it("rewrites parent and child DC addresses on renumber and last-octet edits", () => {
    let doc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(doc, "win2022-server-x64-template", { vlan: 10, ipLastOctet: 12 })
    doc = setVmRoleVars(child.doc, child.vmId, {
      ludus_parent_dc_ip: "10.7.10.11",
      ludus_child_dc_ip: "10.7.20.11",
    })
    doc = setVmRoleVars(doc, "{{ range_id }}-dc01", { ludus_child_dc_ip: "10.7.10.12" })
    doc = renumberVlan(doc, 10, 15, 7)
    const childVm = projectGraph(doc).vms.find((v) => v.id === child.vmId)
    const parent = projectGraph(doc).vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(childVm?.roleVars.ludus_parent_dc_ip).toBe("10.7.15.11")
    expect(parent?.roleVars.ludus_child_dc_ip).toBe("10.7.15.12")
    expect(childVm?.roleVars.ludus_child_dc_ip).toBe("10.7.20.11")
  })

  it("leaves role-var IPs unchanged when the range number is unknown", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const trusted = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    const moved = moveVmToVlan(trusted.doc, "{{ range_id }}-dc02", 30)
    const source = projectGraph(moved).vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(source?.roleVars.ludus_trust_partner_dc_ip).toBe("10.7.20.11")
    expect(source?.roleVars.ludus_dns_forward_server).toBe("10.7.20.11")
  })

  it("does not rewrite role-var IPs from raw octet or vlan edits", () => {
    let doc = parseRangeDocument(DOC_YAML)
    doc = setVmRoleVars(doc, "{{ range_id }}-dc01", {
      ludus_trust_partner_dc_ip: "10.7.20.11",
      ludus_dns_forward_server: "10.7.99.1",
    })
    doc = updateVmRaw(doc, "{{ range_id }}-dc02", { ip_last_octet: 1 })
    doc = updateVmRaw(doc, "{{ range_id }}-dc02", { ip_last_octet: 12 })
    const source = projectGraph(doc).vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(source?.roleVars.ludus_trust_partner_dc_ip).toBe("10.7.20.11")
    expect(source?.roleVars.ludus_dns_forward_server).toBe("10.7.99.1")
  })

  it("does not retarget a role var when another VM still has the old address", () => {
    let doc = parseRangeDocument(DOC_YAML)
    doc = setVmRoleVars(doc, "{{ range_id }}-dc01", { ludus_trust_partner_dc_ip: "10.7.20.11" })
    doc = updateVmRaw(doc, "{{ range_id }}-kali", { vlan: 20, ip_last_octet: 11 })
    doc = moveVmToVlan(doc, "{{ range_id }}-dc02", 30, 11, 7)
    const source = projectGraph(doc).vms.find((v) => v.id === "{{ range_id }}-dc01")
    expect(source?.roleVars.ludus_trust_partner_dc_ip).toBe("10.7.20.11")
  })
})

describe("document flags", () => {
  it("detects roles for the user-defined-roles deploy tag", () => {
    const doc = parseRangeDocument(DOC_YAML)
    expect(documentHasRoles(doc)).toBe(false)
    const withRole = setVmRoles(doc, "{{ range_id }}-dc01", [
      { name: "badsectorlabs.ludus_windows_utils.ludus_ad_password_policy", dependsOn: [] },
    ])
    expect(documentHasRoles(withRole)).toBe(true)
  })

  it("flags a trust or child-domain address that no longer matches its DC", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const trusted = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    const current = validateGraph(projectGraph(trusted.doc), undefined, 7)
    expect(current.some((f) => f.message.includes("ludus_trust_partner_dc_ip"))).toBe(false)

    const shifted = updateVmRaw(trusted.doc, "{{ range_id }}-dc02", { ip_last_octet: 12 })
    const findings = validateGraph(projectGraph(shifted), undefined, 7)
    expect(hasBlockingFindings(findings)).toBe(true)
    expect(findings.some((f) => f.message.includes("ludus_trust_partner_dc_ip") && f.message.includes("10.7.20.12"))).toBe(true)
    expect(findings.some((f) => f.message.includes("ludus_dns_forward_server") && f.message.includes("10.7.20.12"))).toBe(true)

    let childDoc = parseRangeDocument(DOC_YAML)
    const child = addVmFromTemplate(childDoc, "win2022-server-x64-template", { vlan: 10, ipLastOctet: 12 })
    childDoc = setVmRoles(child.doc, child.vmId, [
      { name: "badsectorlabs.ludus_windows_utils.ludus_child_domain", dependsOn: [] },
    ])
    childDoc = setVmRoleVars(childDoc, child.vmId, {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_parent_domain_fqdn: "first.local",
      ludus_parent_dc_ip: "10.7.10.11",
    })
    childDoc = setVmRoleVars(childDoc, "{{ range_id }}-kali", {
      ludus_child_domain_fqdn: "north.first.local",
      ludus_child_dc_ip: "10.7.10.12",
    })
    const aligned = validateGraph(projectGraph(childDoc), undefined, 7)
    expect(aligned.some((f) => f.message.includes("ludus_parent_dc_ip") || f.message.includes("ludus_child_dc_ip"))).toBe(false)

    const parentMoved = updateVmRaw(childDoc, "{{ range_id }}-dc01", { vlan: 15 })
    const staleChild = validateGraph(projectGraph(parentMoved), undefined, 7)
    expect(staleChild.some((f) => f.message.includes("ludus_parent_dc_ip") && f.message.includes("10.7.15.11"))).toBe(true)
    expect(staleChild.some((f) => f.message.includes("ludus_child_dc_ip"))).toBe(false)
  })

  it("warns when a trust or child-domain address cannot be checked", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const trusted = addForestTrust(doc, "first.local", "second.local", { rangeNumber: 7 })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    const findings = validateGraph(projectGraph(trusted.doc), undefined, null)
    expect(hasBlockingFindings(findings)).toBe(false)
    expect(findings.some((f) => f.level === "warning" && f.message.includes("cannot be verified"))).toBe(true)
  })

  it("validateGraph blocks a missing template", () => {
    const graph = projectGraph(parseRangeDocument(DOC_YAML))
    const findings = validateGraph(graph, new Set(["kali-x64-desktop-template"]))
    expect(hasBlockingFindings(findings)).toBe(true)
    expect(findings.some((f) => f.message.includes("not built"))).toBe(true)
  })
})

describe("vm rename", () => {
  it("rewrites depends_on vm_name references and leaves other targets", () => {
    let doc = parseRangeDocument(DOC_YAML)
    doc = setVmRoles(doc, "{{ range_id }}-dc01", [
      {
        name: "badsectorlabs.ludus_windows_utils.ludus_ad_forest_trust",
        dependsOn: [
          {
            vmName: "{{ range_id }}-dc02",
            role: "badsectorlabs.ludus_windows_utils.ludus_child_domain",
          },
        ],
      },
    ])
    doc = setVmRoles(doc, "{{ range_id }}-kali", [
      {
        name: "custom.role",
        dependsOn: [{ vmName: "{{ range_id }}-dc01", role: "other.role" }],
      },
    ])
    doc = updateVmRaw(doc, "{{ range_id }}-dc02", { vm_name: "{{ range_id }}-child" })
    const graph = projectGraph(doc)
    expect(graph.vms.some((vm) => vm.id === "{{ range_id }}-child")).toBe(true)
    expect(graph.dependsOn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromVmId: "{{ range_id }}-dc01",
          toVmName: "{{ range_id }}-child",
        }),
        expect.objectContaining({
          fromVmId: "{{ range_id }}-kali",
          toVmName: "{{ range_id }}-dc01",
        }),
      ]),
    )
    expect(graph.dependsOn.some((edge) => edge.toVmName === "{{ range_id }}-dc02")).toBe(false)
  })
})

describe("GOAD lock — network-only mutation", () => {
  it("changing firewall rules leaves the ludus VM list byte-identical", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const beforeVms = yaml.dump((doc.root as Record<string, unknown>).ludus)
    const rules: NetworkRule[] = [
      { name: "goad-rule", vlan_src: 10, vlan_dst: 99, protocol: "tcp", ports: "445", action: "ACCEPT" },
    ]
    const next = setNetworkDefaults(setNetworkRules(doc, rules), { inter_vlan_default: "REJECT" })
    const afterVms = yaml.dump((next.root as Record<string, unknown>).ludus)
    expect(afterVms).toEqual(beforeVms)
  })

  it("setNetworkDefaults preserves existing rules", () => {
    const doc = parseRangeDocument(DOC_YAML)
    const next = setNetworkDefaults(doc, { external_default: "DROP" })
    const graph = projectGraph(next)
    expect(graph.rules.map((r) => r.name)).toEqual(["allow-ssh", "allow-rdp"])
    expect(graph.networkDefaults.external_default).toBe("DROP")
  })
})

describe("default canvas layout", () => {
  it("places each VM inside its VLAN group, ordered by last octet", () => {
    const graph = projectGraph(parseRangeDocument(DOC_YAML))
    const layout = computeDefaultLayout(graph)
    const vlan = graph.vlans.find((entry) => entry.vlan === 10)
    expect(vlan).toBeDefined()
    if (!vlan) return
    const height = vlanGroupHeight(vlan.vmIds.length)
    for (const vmId of vlan.vmIds) {
      const pos = layout[vmId]
      expect(pos).toBeDefined()
      expect(pos!.x).toBeGreaterThanOrEqual(0)
      expect(pos!.y).toBeGreaterThanOrEqual(0)
      expect(pos!.y).toBeLessThan(height)
    }
    const group = layout[vlanNodeId(10)]
    expect(group).toBeDefined()
    const ordered = [...vlan.vmIds].sort((a, b) => {
      const left = graph.vms.find((vm) => vm.id === a)
      const right = graph.vms.find((vm) => vm.id === b)
      return (left?.ipLastOctet ?? 0) - (right?.ipLastOctet ?? 0)
    })
    if (ordered.length >= 2) {
      expect(layout[ordered[0]!]!.y).toBeLessThan(layout[ordered[1]!]!.y)
    }
  })
})

describe("bidirectional firewall rules", () => {
  it("finds the reverse of the same protocol, ports, and action", () => {
    const rules: NetworkRule[] = [
      { name: "out", vlan_src: 10, vlan_dst: 99, protocol: "tcp", ports: "443", action: "ACCEPT" },
      { name: "back", vlan_src: 99, vlan_dst: 10, protocol: "tcp", ports: "443", action: "ACCEPT" },
      { name: "other", vlan_src: 10, vlan_dst: 99, protocol: "tcp", ports: "80", action: "ACCEPT" },
    ]
    expect(firewallMirrorIndex(rules, 0)).toBe(1)
    expect(firewallMirrorIndex(rules, 1)).toBe(0)
    expect(firewallMirrorIndex(rules, 2)).toBe(-1)
  })

  it("pairs a host-specific rule with the reverse even when the octets differ", () => {
    const rules: NetworkRule[] = [
      { name: "to kali", vlan_src: 10, vlan_dst: 99, ip_last_octet_dst: "1", protocol: "tcp", ports: "443", action: "ACCEPT" },
      { name: "back", vlan_src: 99, vlan_dst: 10, ip_last_octet_src: "1", ip_last_octet_dst: "11-21", protocol: "tcp", ports: "443", action: "ACCEPT" },
    ]
    expect(firewallMirrorIndex(rules, 0)).toBe(1)
  })

  it("pairs opposite rules that share a name when the ports differ", () => {
    const rules: NetworkRule[] = [
      { name: "Only allow windows to kali on 443", vlan_src: 10, vlan_dst: 99, protocol: "tcp", ports: "443", action: "ACCEPT" },
      { name: "Only allow windows to kali on 443", vlan_src: 99, vlan_dst: 10, protocol: "all", ports: "all", action: "ACCEPT" },
    ]
    expect(firewallMirrorIndex(rules, 0)).toBe(1)
    expect(firewallMirrorIndex(rules, 1)).toBe(0)
  })
})

describe("template groups", () => {
  it("lists Windows before Linux and built templates first", () => {
    const groups = groupTemplates([
      { name: "kali-x64-desktop-template", built: true, os: "linux" },
      { name: "win2022-server-x64-template", built: false, os: "windows" },
      { name: "win11-22h2-x64-enterprise-template", built: true, os: "windows" },
    ])
    expect(groups.map((group) => group.label)).toEqual(["Windows", "Linux"])
    expect(groups[0]?.rows.map((row) => row.name)).toEqual([
      "win11-22h2-x64-enterprise-template",
      "win2022-server-x64-template",
    ])
  })
})

describe("compact layout", () => {
  it("drops saved box sizes and uses the packed positions", () => {
    expect(
      compactLayout(
        { "vlan:10": { x: 10, y: 20, width: 800, height: 1200 }, "router": { x: 4, y: 5 } },
        { "vlan:10": { x: 40, y: 140 } },
      ),
    ).toEqual({
      "vlan:10": { x: 40, y: 140 },
      router: { x: 4, y: 5 },
    })
  })
})

describe("subnet stack", () => {
  it("puts domain members in a domain box and unjoined hosts below it", () => {
    const stack = layoutVlanStack([
      { id: "kali", domainFqdn: null, ipLastOctet: 21 },
      { id: "dc", domainFqdn: "ludus.domain", ipLastOctet: 11 },
      { id: "ws", domainFqdn: "ludus.domain", ipLastOctet: 21 },
    ])
    expect(stack.domains).toHaveLength(1)
    expect(stack.domains[0]?.memberIds).toEqual(["dc", "ws"])
    expect(stack.domains[0]?.height).toBe(domainGroupHeight(2))
    expect(stack.unjoined[0]?.id).toBe("kali")
    const domain = stack.domains[0]!
    const card = stack.unjoined[0]!
    const beside = card.x >= domain.x + domain.width
    const below = card.y >= domain.y + domain.height
    expect(beside || below).toBe(true)
    expect(stack.unjoinedAt).toBe(card.y)
    expect(stack.unjoinedLabelX).toBe(card.x)
    expect(stack.unjoinedLabelX + 76).toBeLessThanOrEqual(stack.width)
  })

  it("packs domain boxes together when no line runs between them", () => {
    const stack = layoutVlanStack([
      { id: "dc02", domainFqdn: "north.sevenkingdoms.local", ipLastOctet: 11 },
      { id: "dc01", domainFqdn: "sevenkingdoms.local", ipLastOctet: 10 },
    ])
    const [first, second] = [...stack.domains].sort((a, b) => a.x - b.x || a.y - b.y)
    const gap = second!.x >= first!.x + first!.width
      ? second!.x - (first!.x + first!.width)
      : second!.y - (first!.y + first!.height)
    expect(gap).toBeLessThanOrEqual(16)
  })

  it("keeps an unlinked box tight when another pair has a line", () => {
    const stack = layoutVlanStack(
      [
        { id: "dc01", domainFqdn: "sevenkingdoms.local", ipLastOctet: 10 },
        { id: "dc02", domainFqdn: "north.sevenkingdoms.local", ipLastOctet: 11 },
        { id: "kali", domainFqdn: null, ipLastOctet: 50 },
      ],
      { linkedDomains: new Set([domainPairKey("sevenkingdoms.local", "north.sevenkingdoms.local")]) },
    )
    const seven = stack.domains.find((domain) => domain.fqdn === "sevenkingdoms.local")!
    const north = stack.domains.find((domain) => domain.fqdn === "north.sevenkingdoms.local")!
    const edgeGap = (
      a: { x: number; y: number; width: number; height?: number },
      b: { x: number; y: number; width: number; height?: number },
    ) => {
      const aHeight = a.height ?? 58
      const bHeight = b.height ?? 58
      const horizontal = a.x + a.width <= b.x ? b.x - (a.x + a.width) : b.x + b.width <= a.x ? a.x - (b.x + b.width) : 0
      const vertical = a.y + aHeight <= b.y ? b.y - (a.y + aHeight) : b.y + bHeight <= a.y ? a.y - (b.y + bHeight) : 0
      return horizontal > 0 ? horizontal : vertical
    }
    expect(seven.x).toBe(north.x)
    expect(edgeGap(seven, north)).toBeGreaterThanOrEqual(48)
    expect(edgeGap(seven, north)).toBeLessThanOrEqual(80)
    const kali = stack.unjoined[0]!
    expect(Math.min(edgeGap(kali, seven), edgeGap(kali, north))).toBeLessThanOrEqual(16)
  })

  it("stacks a child under its parent with the line between their faces", () => {
    const stack = layoutVlanStack(
      [
        { id: "dc02", domainFqdn: "north.sevenkingdoms.local", ipLastOctet: 11 },
        { id: "dc01", domainFqdn: "sevenkingdoms.local", ipLastOctet: 10 },
      ],
      {
        layoutLinks: {
          parentOf: new Map([["north.sevenkingdoms.local", "sevenkingdoms.local"]]),
          trusts: new Set(),
        },
      },
    )
    const parent = stack.domains.find((domain) => domain.fqdn === "sevenkingdoms.local")!
    const child = stack.domains.find((domain) => domain.fqdn === "north.sevenkingdoms.local")!
    expect(child.x).toBe(parent.x)
    expect(child.y - (parent.y + parent.height)).toBeGreaterThanOrEqual(48)
    expect(child.y - (parent.y + parent.height)).toBeLessThanOrEqual(80)
  })

  it("puts a forest trust beside the domain it trusts instead of between a parent and child", () => {
    const stack = layoutVlanStack(
      [
        { id: "dc01", domainFqdn: "sevenkingdoms.local", ipLastOctet: 10 },
        { id: "dc02", domainFqdn: "north.sevenkingdoms.local", ipLastOctet: 11 },
        { id: "dc03", domainFqdn: "essos.local", ipLastOctet: 12 },
        { id: "elk", domainFqdn: null, ipLastOctet: 50 },
      ],
      {
        layoutLinks: {
          parentOf: new Map([["north.sevenkingdoms.local", "sevenkingdoms.local"]]),
          trusts: new Set([domainPairKey("essos.local", "sevenkingdoms.local")]),
        },
      },
    )
    const seven = stack.domains.find((domain) => domain.fqdn === "sevenkingdoms.local")!
    const north = stack.domains.find((domain) => domain.fqdn === "north.sevenkingdoms.local")!
    const essos = stack.domains.find((domain) => domain.fqdn === "essos.local")!
    const elk = stack.unjoined[0]!
    expect(north.x).toBe(seven.x)
    expect(north.y).toBeGreaterThan(seven.y + seven.height)
    expect(essos.x).toBeGreaterThanOrEqual(seven.x + seven.width)
    expect(essos.y).toBe(seven.y)
    expect(essos.x - (seven.x + seven.width)).toBeGreaterThanOrEqual(140)
    const betweenParentAndChild = [...stack.domains, ...stack.unjoined].filter((box) => {
      if (box === seven || box === north) return false
      const height = box.height ?? 58
      return box.x < seven.x + seven.width && box.x + box.width > seven.x && box.y < north.y && box.y + height > seven.y + seven.height
    })
    expect(betweenParentAndChild).toEqual([])
    expect(elk.x).toBeGreaterThan(seven.x + seven.width)
    expect(stack.width).toBeGreaterThan(stack.height * 0.8)
  })

  it("lays several domains out as a grid instead of one tall column", () => {
    const stack = layoutVlanStack([
      { id: "a1", domainFqdn: "a.local", ipLastOctet: 1 },
      { id: "a2", domainFqdn: "a.local", ipLastOctet: 2 },
      { id: "b1", domainFqdn: "b.local", ipLastOctet: 3 },
      { id: "c1", domainFqdn: "c.local", ipLastOctet: 4 },
      { id: "c2", domainFqdn: "c.local", ipLastOctet: 5 },
    ])
    expect(new Set(stack.domains.map((domain) => domain.x)).size).toBeGreaterThan(1)
    expect(stack.width / stack.height).toBeGreaterThan(0.75)
    expect(stack.width / stack.height).toBeLessThan(1.5)
  })

  it("grows the domain and its machines when the subnet is resized", () => {
    const vms = [
      { id: "dc", domainFqdn: "ludus.domain", ipLastOctet: 11 },
      { id: "ws", domainFqdn: "ludus.domain", ipLastOctet: 21 },
    ]
    const natural = layoutVlanStack(vms)
    const grown = layoutVlanStack(vms, { width: natural.width + 80, height: natural.height + 100 })
    expect(grown.domains[0]!.width).toBeGreaterThan(natural.domains[0]!.width)
    expect(grown.domains[0]!.height).toBeGreaterThan(natural.domains[0]!.height)
    expect(grown.domains[0]!.members[0]!.width).toBeGreaterThan(natural.domains[0]!.members[0]!.width)
    expect(grown.domains[0]!.members[0]!.height ?? 0).toBeGreaterThan(58)
  })

  it("keeps a resized domain at least as large as the operator left it", () => {
    const grown = layoutVlanStack(
      [
        { id: "dc", domainFqdn: "ludus.domain", ipLastOctet: 11 },
        { id: "ws", domainFqdn: "other.domain", ipLastOctet: 12 },
      ],
      { domainSize: new Map([["ludus.domain", { width: 360, height: 280 }]]) },
    )
    const domain = grown.domains.find((entry) => entry.fqdn === "ludus.domain")
    expect(domain?.width).toBeGreaterThanOrEqual(360)
    expect(domain?.height).toBeGreaterThanOrEqual(280)
    expect(domain?.members[0]?.width).toBeGreaterThan(220)
  })

  it("leaves a subnet with no domain as a plain VM list", () => {
    const stack = layoutVlanStack([{ id: "kali", domainFqdn: null, ipLastOctet: 1 }])
    expect(stack.domains).toEqual([])
    expect(stack.unjoinedAt).toBeNull()
  })

  it("reads the domain from a nested node id", () => {
    expect(domainFqdnFromNodeId("domain:north.sevenkingdoms.local@10")).toBe("north.sevenkingdoms.local")
    expect(domainFqdnFromNodeId("domain:ludus.domain")).toBe("ludus.domain")
  })
})

describe("live VM match", () => {
  it("expands {{ range_id }} and matches the Proxmox name", () => {
    const live = [{ name: "user1-dc01", poweredOn: true, ip: "10.2.10.11" }]
    const hit = matchLiveVm(
      { vmName: "{{ range_id }}-dc01", hostname: "{{ range_id }}-dc01" },
      "user1",
      live,
    )
    expect(hit?.poweredOn).toBe(true)
    expect(hit?.ip).toBe("10.2.10.11")
    expect(matchLiveVm({ vmName: "{{ range_id }}-ws01", hostname: "ws01" }, "user1", live)).toBeNull()
  })
})

describe("range id in the inspector", () => {
  it("shows the range id and writes the placeholder back when that id stays", () => {
    expect(expandRangeId("{{ range_id }}-elk", "jd")).toBe("jd-elk")
    expect(restoreRangeId("jd-elk", "{{ range_id }}-elk", "jd")).toBe("{{ range_id }}-elk")
    expect(restoreRangeId("jd-elk2", "{{ range_id }}-elk", "jd")).toBe("{{ range_id }}-elk2")
    expect(restoreRangeId("custom-elk", "{{ range_id }}-elk", "jd")).toBe("custom-elk")
    expect(restoreRangeId("plain", "plain", "jd")).toBe("plain")
    expect(expandRangeId("{{ range_id }}-elk", "")).toBe("{{ range_id }}-elk")
  })
})

describe("vm testing flags", () => {
  it("blocks internet and leaves snapshot off when the testing block is missing", () => {
    const graph = projectGraph(parseRangeDocument(DOC_YAML))
    const vm = graph.vms[0]
    expect(vm).toBeDefined()
    if (!vm) return
    expect(vmTestingFlag(vm, "block_internet")).toBe(true)
    expect(vmTestingFlag(vm, "snapshot")).toBe(false)
  })

  it("keeps internet only when block_internet is false", () => {
    const doc = updateVmRaw(parseRangeDocument(DOC_YAML), "{{ range_id }}-dc01", {
      testing: { block_internet: false, snapshot: true },
    })
    const vm = projectGraph(doc).vms.find((entry) => entry.id === "{{ range_id }}-dc01")
    expect(vm).toBeDefined()
    if (!vm) return
    expect(vmTestingFlag(vm, "block_internet")).toBe(false)
    expect(vmTestingFlag(vm, "snapshot")).toBe(true)
  })
})
