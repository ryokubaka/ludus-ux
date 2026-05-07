import { describe, expect, it } from "vitest"
import { isLudusRangeRouterVmName, snapshotTargetProxmoxIdsExcludingRouter } from "./ludus-range-router-vm"
import type { VMObject } from "./types"

describe("isLudusRangeRouterVmName", () => {
  it("detects Ludus router template name", () => {
    expect(isLudusRangeRouterVmName("DEMO-router-debian11-x64")).toBe(true)
    expect(isLudusRangeRouterVmName("my-range-Router-Debian12-x64")).toBe(true)
  })
  it("does not flag lab VMs", () => {
    expect(isLudusRangeRouterVmName("DEMO-kali")).toBe(false)
    expect(isLudusRangeRouterVmName("DEMO-ad-win11")).toBe(false)
  })
})

describe("snapshotTargetProxmoxIdsExcludingRouter", () => {
  it("drops router VM", () => {
    const vms: VMObject[] = [
      { ID: 1, proxmoxID: 100, rangeNumber: 1, name: "R-router-debian11-x64", poweredOn: true, ip: "" },
      { ID: 2, proxmoxID: 101, rangeNumber: 1, name: "R-kali", poweredOn: true, ip: "" },
    ]
    expect(snapshotTargetProxmoxIdsExcludingRouter(vms)).toEqual([101])
  })
})
