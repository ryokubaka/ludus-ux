import { describe, expect, it } from "vitest"
import { markTemplatesFromProxmox, parseProxmoxGuests } from "@/lib/proxmox/proxmox-template-guests"

describe("parseProxmoxGuests", () => {
  it("keeps qemu templates and plain VMs, and prefers a template of the same name", () => {
    const guests = parseProxmoxGuests([
      { vmid: 10, name: "debian-13-x64-server-template", type: "qemu", template: 1, node: "ludus" },
      { vmid: 282, name: "securityonion-3.3-x64-template", type: "qemu", node: "ludus" },
      { vmid: 283, name: "securityonion-3.3-x64-template", type: "qemu", template: "1", node: "ludus" },
      { vmid: 1, name: "storage", type: "storage" },
    ])
    expect(guests).toEqual([
      { name: "debian-13-x64-server-template", vmid: 10, node: "ludus", template: true },
      { name: "securityonion-3.3-x64-template", vmid: 283, node: "ludus", template: true },
    ])
  })
})

describe("markTemplatesFromProxmox", () => {
  it("marks a Proxmox template built and a same-named VM as not a template", () => {
    const rows = markTemplatesFromProxmox(
      [
        { name: "securityonion-3.3-x64-template", built: false },
        { name: "kali-x64-desktop-template", built: false },
        { name: "debian-13-x64-server-template", built: true },
      ],
      [
        { name: "securityonion-3.3-x64-template", vmid: 282, node: "ludus", template: false },
        { name: "debian-13-x64-server-template", vmid: 10, node: "ludus", template: true },
      ],
    )
    expect(rows[0]).toMatchObject({ built: false, proxmox: "vm" })
    expect(rows[1].proxmox).toBeUndefined()
    expect(rows[2]).toMatchObject({ built: true, proxmox: "template" })
  })
})
