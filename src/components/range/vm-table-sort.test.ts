import { describe, expect, it } from "vitest"
import type { VMObject } from "@/lib/core/types"
import { compareVmRows, ipv4SortValue } from "@/components/range/vm-table-sort"

function vm(partial: Partial<VMObject> & Pick<VMObject, "name" | "ip" | "proxmoxID">): VMObject {
  return {
    ID: partial.proxmoxID,
    rangeNumber: 1,
    poweredOn: false,
    ...partial,
  }
}

const nameOf = (row: VMObject) => row.name
const runningOf = (row: VMObject) => row.poweredOn

describe("ipv4SortValue", () => {
  it("orders octets numerically", () => {
    expect(ipv4SortValue("10.2.10.50")).toBeLessThan(ipv4SortValue("10.2.10.254")!)
    expect(ipv4SortValue("10.2.10.10")).toBeLessThan(ipv4SortValue("10.2.10.31")!)
  })

  it("rejects a missing address", () => {
    expect(ipv4SortValue(undefined)).toBeNull()
    expect(ipv4SortValue("null")).toBeNull()
    expect(ipv4SortValue("not-an-ip")).toBeNull()
  })
})

describe("compareVmRows", () => {
  const rows = [
    vm({ name: "elk", ip: "10.2.10.50", proxmoxID: 144, poweredOn: true }),
    vm({ name: "dc", ip: "10.2.10.10", proxmoxID: 165, poweredOn: true }),
    vm({ name: "win", ip: "10.2.10.31", proxmoxID: 207, poweredOn: false }),
    vm({ name: "router", ip: "10.2.10.254", proxmoxID: 155, poweredOn: true }),
    vm({ name: "pending", ip: "", proxmoxID: 180, poweredOn: false }),
  ]

  it("sorts by IP ascending and keeps a missing address last", () => {
    const sorted = [...rows].sort((a, b) => compareVmRows(a, b, { key: "ip", dir: "asc" }, nameOf, runningOf))
    expect(sorted.map((row) => row.name)).toEqual(["dc", "win", "elk", "router", "pending"])
  })

  it("sorts by IP descending and keeps a missing address last", () => {
    const sorted = [...rows].sort((a, b) => compareVmRows(a, b, { key: "ip", dir: "desc" }, nameOf, runningOf))
    expect(sorted.map((row) => row.name)).toEqual(["router", "elk", "win", "dc", "pending"])
  })

  it("sorts by name, status, and VMID", () => {
    const byName = [...rows].sort((a, b) => compareVmRows(a, b, { key: "name", dir: "asc" }, nameOf, runningOf))
    expect(byName.map((row) => row.name)).toEqual(["dc", "elk", "pending", "router", "win"])

    const byStatus = [...rows].sort((a, b) => compareVmRows(a, b, { key: "status", dir: "desc" }, nameOf, runningOf))
    expect(byStatus.filter((row) => row.poweredOn).map((row) => row.name)).toEqual(["dc", "elk", "router"])

    const byId = [...rows].sort((a, b) => compareVmRows(a, b, { key: "vmid", dir: "asc" }, nameOf, runningOf))
    expect(byId.map((row) => row.proxmoxID)).toEqual([144, 155, 165, 180, 207])
  })
})
