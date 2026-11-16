import yaml from "js-yaml"
import { describe, expect, it } from "vitest"
import { canonicalRangeYaml } from "@/lib/range/range-builder-document"
import { applyBlueprintNetwork, pickBlueprintCanvasYaml } from "./blueprint-apply"

describe("pickBlueprintCanvasYaml", () => {
  const previous = canonicalRangeYaml("ludus: []\n")
  const range = "ludus:\n  - vm_name: from-range\n"
  const blueprint = "ludus:\n  - vm_name: from-blueprint\n"

  it("draws the range file when apply changed it", () => {
    const picked = pickBlueprintCanvasYaml(previous, range, blueprint)
    expect(picked.source).toBe("range")
    expect(picked.canonical).toBe(canonicalRangeYaml(range))
  })

  it("draws the blueprint when the range file is still the previous one", () => {
    const picked = pickBlueprintCanvasYaml(previous, "ludus: []\n", blueprint)
    expect(picked.source).toBe("blueprint")
    expect(picked.canonical).toBe(canonicalRangeYaml(blueprint))
  })

  it("replaces firewall rules with the blueprint network block", () => {
    const applied = applyBlueprintNetwork(
      `ludus:
  - vm_name: kept
network:
  inter_vlan_default: ACCEPT
  rules:
    - name: old rule
      vlan_src: 10
      vlan_dst: 10
      protocol: all
      ports: all
      action: ACCEPT
`,
      `ludus:
  - vm_name: from-blueprint
network:
  inter_vlan_default: DROP
  rules:
    - name: blueprint rule
      vlan_src: 20
      vlan_dst: 20
      protocol: tcp
      ports: "443"
      action: ACCEPT
`,
    )
    const doc = yaml.load(applied) as {
      ludus: { vm_name: string }[]
      network: { inter_vlan_default: string; rules: { name: string }[] }
    }
    expect(doc.ludus.map((vm) => vm.vm_name)).toEqual(["kept"])
    expect(doc.network.inter_vlan_default).toBe("DROP")
    expect(doc.network.rules.map((rule) => rule.name)).toEqual(["blueprint rule"])
  })

  it("drops firewall rules when the blueprint has no network block", () => {
    const applied = applyBlueprintNetwork(
      `ludus:
  - vm_name: kept
network:
  rules:
    - name: old rule
      vlan_src: 10
      vlan_dst: 10
      protocol: all
      ports: all
      action: ACCEPT
`,
      "ludus:\n  - vm_name: from-blueprint\n",
    )
    const doc = yaml.load(applied) as { network?: unknown; ludus: { vm_name: string }[] }
    expect(doc.ludus.map((vm) => vm.vm_name)).toEqual(["kept"])
    expect(doc.network).toBeUndefined()
  })

  it("leaves the picture alone when both copies match the current file", () => {
    const picked = pickBlueprintCanvasYaml(previous, "ludus: []\n", "ludus: []\n")
    expect(picked.source).toBe("unchanged")
    expect(picked.canonical).toBe(previous)
  })
})
