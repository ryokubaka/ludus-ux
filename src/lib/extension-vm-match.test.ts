import { describe, expect, it } from "vitest"
import type { VMObject } from "./types"
import { matchingVmIdsForExtension } from "./extension-vm-match"

function makeVM(name: string, proxmoxID: number): VMObject {
  return { ID: proxmoxID, proxmoxID, rangeNumber: 1, name, poweredOn: true, ip: "10.0.0.1" }
}

describe("matchingVmIdsForExtension", () => {
  const vms = [
    makeVM("user-range-GOAD-dc01", 100),
    makeVM("user-range-GOAD-ws02", 101),
    makeVM("user-range-OTHER-srv01", 102),
  ]

  it("matches VMs by catalog machines array (exact)", () => {
    const ids = matchingVmIdsForExtension("elk", ["user-range-GOAD-dc01"], vms)
    expect(ids).toEqual([100])
  })

  it("matches by short-name substring", () => {
    const ids = matchingVmIdsForExtension("dc01", [], vms)
    expect(ids).toContain(100)
  })

  it("matches by extension slug substring fallback", () => {
    const ids = matchingVmIdsForExtension("ws02", [], vms)
    expect(ids).toContain(101)
  })

  it("does not match short slugs (< 3 chars)", () => {
    const ids = matchingVmIdsForExtension("dc", [], vms)
    expect(ids).toHaveLength(0)
  })

  it("matches by FQDN machines entry", () => {
    const ids = matchingVmIdsForExtension("test", ["ws02.essos.local"], [
      makeVM("user-range-GOAD-ws02", 200),
    ])
    expect(ids).toContain(200)
  })

  it("handles object-style machines", () => {
    const ids = matchingVmIdsForExtension("ext", { "dc01": {}, "ws02": {} }, vms)
    expect(ids).toContain(100)
    expect(ids).toContain(101)
  })

  it("handles machines with name/hostname objects", () => {
    const ids = matchingVmIdsForExtension("ext", [{ name: "dc01" }], vms)
    expect(ids).toContain(100)
  })

  it("returns empty and warns for no matches", () => {
    const ids = matchingVmIdsForExtension("nonexistent-extension", [], vms)
    expect(ids).toHaveLength(0)
  })

  it("returns empty for empty VM list", () => {
    const ids = matchingVmIdsForExtension("test", ["dc01"], [])
    expect(ids).toHaveLength(0)
  })
})
