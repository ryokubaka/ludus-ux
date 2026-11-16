import { describe, expect, it } from "vitest"
import type { GoadDirectory } from "@/lib/goad/goad-domain-map"
import { graphForGoadPreview } from "./goad-preview-graph"

const YAML = `ludus:
  - vm_name: lab-DC01
    hostname: DC01
    template: win2019-server-x64-template
    vlan: 10
    ip_last_octet: 10
    windows: {}
  - vm_name: lab-WS01
    hostname: WS01
    template: win11-22h2-x64-template
    vlan: 10
    ip_last_octet: 20
    windows: {}
`

const directory: GoadDirectory = {
  hosts: [
    { key: "dc01", hostname: "DC01", domain: "north.sevenkingdoms.local", role: "primary-dc", ipLastOctet: 10 },
    { key: "ws01", hostname: "WS01", domain: "north.sevenkingdoms.local", role: "member", ipLastOctet: 20 },
  ],
  domains: [{ fqdn: "north.sevenkingdoms.local", childOf: null, trust: null }],
}

describe("graphForGoadPreview", () => {
  it("draws the lab machines and joins them from the domain map", () => {
    const graph = graphForGoadPreview(YAML, directory, "lab")
    expect(graph?.vms.map((vm) => vm.vmName)).toEqual(["lab-DC01", "lab-WS01"])
    expect(graph?.vms.every((vm) => vm.domainFqdn === "north.sevenkingdoms.local")).toBe(true)
    expect(graph?.domains.map((domain) => domain.fqdn)).toEqual(["north.sevenkingdoms.local"])
  })

  it("drops an extension machine when the preview no longer includes it", () => {
    const withExtension = `${YAML}
  - vm_name: lab-SRV01
    hostname: SRV01
    template: win2019-server-x64-template
    vlan: 10
    ip_last_octet: 30
    windows: {}
`
    const extended = graphForGoadPreview(withExtension, directory, "lab")
    const base = graphForGoadPreview(YAML, directory, "lab")
    expect(extended?.vms.some((vm) => vm.hostname === "SRV01")).toBe(true)
    expect(base?.vms.some((vm) => vm.hostname === "SRV01")).toBe(false)
  })

  it("returns null when the preview has no machines", () => {
    expect(graphForGoadPreview("ludus: []\n", directory, "lab")).toBeNull()
    expect(graphForGoadPreview("not: yaml: [", null, "lab")).toBeNull()
  })
})
