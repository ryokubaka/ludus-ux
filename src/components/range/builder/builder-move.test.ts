import { describe, expect, it } from "vitest"
import { domainVlanFromNodeId, hostDropTarget, type DropRect } from "./builder-move"

const vlan10: DropRect & { vlan: number } = { id: "vlan:10", vlan: 10, x: 0, y: 0, width: 300, height: 500 }
const vlan99: DropRect & { vlan: number } = { id: "vlan:99", vlan: 99, x: 400, y: 0, width: 300, height: 320 }
const ludus: DropRect & { fqdn: string; vlan: number | null } = {
  id: "domain:ludus.domain@10",
  fqdn: "ludus.domain",
  vlan: 10,
  x: 12,
  y: 52,
  width: 244,
  height: 180,
}
const kali: DropRect & { fqdn: string; vlan: number | null } = {
  id: "domain:kali.local@99",
  fqdn: "kali.local",
  vlan: 99,
  x: 412,
  y: 52,
  width: 244,
  height: 120,
}

function vm(rect: DropRect, parentId: string | null, currentVlan: number | null) {
  return hostDropTarget({
    moving: "vm",
    rect,
    parentId,
    currentVlan,
    domains: [ludus, kali],
    vlans: [vlan10, vlan99],
  })
}

describe("host drop target", () => {
  it("joins the domain under a machine", () => {
    expect(vm({ id: "vm", x: 40, y: 80, width: 180, height: 48 }, "vlan:10", 10)).toEqual({
      kind: "join-domain",
      fqdn: "ludus.domain",
      vlan: 10,
    })
  })

  it("keeps a machine that is already in that domain", () => {
    expect(vm({ id: "vm", x: 40, y: 80, width: 180, height: 48 }, ludus.id, 10)).toEqual({ kind: "stay" })
  })

  it("leaves a domain when dropped in the subnet's unjoined area", () => {
    expect(vm({ id: "vm", x: 40, y: 360, width: 180, height: 48 }, ludus.id, 10)).toEqual({
      kind: "place-vlan",
      vlan: 10,
      unjoin: true,
    })
  })

  it("moves an unjoined machine onto another subnet", () => {
    expect(vm({ id: "vm", x: 430, y: 200, width: 180, height: 48 }, "vlan:10", 10)).toEqual({
      kind: "place-vlan",
      vlan: 99,
      unjoin: false,
    })
  })

  it("joins the domain on the subnet the machine was dropped on", () => {
    expect(vm({ id: "vm", x: 430, y: 70, width: 180, height: 48 }, ludus.id, 10)).toEqual({
      kind: "join-domain",
      fqdn: "kali.local",
      vlan: 99,
    })
  })

  it("snaps a machine dropped outside every subnet", () => {
    expect(vm({ id: "vm", x: -400, y: -200, width: 180, height: 48 }, "vlan:10", 10)).toEqual({ kind: "snap" })
  })

  it("moves a domain onto the subnet that covers more of it", () => {
    expect(
      hostDropTarget({
        moving: "domain",
        rect: { id: ludus.id, x: 420, y: 40, width: 220, height: 140 },
        parentId: "vlan:10",
        currentVlan: 10,
        domains: [],
        vlans: [vlan10, vlan99],
      }),
    ).toEqual({ kind: "move-domain", toVlan: 99 })
  })

  it("leaves a domain where it is when it still sits in its subnet", () => {
    expect(
      hostDropTarget({
        moving: "domain",
        rect: ludus,
        parentId: "vlan:10",
        currentVlan: 10,
        domains: [],
        vlans: [vlan10, vlan99],
      }),
    ).toEqual({ kind: "stay" })
  })
})

describe("domain vlan from node id", () => {
  it("reads the subnet baked into a grouped domain id", () => {
    expect(domainVlanFromNodeId("domain:ludus.domain@10")).toBe(10)
    expect(domainVlanFromNodeId("domain:lab.local")).toBeNull()
  })
})
