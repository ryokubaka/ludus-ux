import { describe, expect, it } from "vitest"
import {
  pendingVmPowerNames,
  vmMatchesExpectedPower,
  waitForVmPowerConfirmation,
} from "./wait-for-vm-power-state"
import type { VMObject } from "./types"

const vm = (name: string, poweredOn: boolean): VMObject => ({
  ID: 1,
  proxmoxID: 100,
  rangeNumber: 1,
  name,
  poweredOn,
  ip: "",
})

describe("vmMatchesExpectedPower", () => {
  it("treats poweredOn as authoritative", () => {
    expect(vmMatchesExpectedPower(vm("a", true), "on")).toBe(true)
    expect(vmMatchesExpectedPower(vm("a", false), "off")).toBe(true)
    expect(vmMatchesExpectedPower(vm("a", false), "on")).toBe(false)
  })
})

describe("pendingVmPowerNames", () => {
  it("lists VMs not yet at target state", () => {
    const vms = [vm("one", true), vm("two", false)]
    expect(pendingVmPowerNames(vms, ["one", "two"], "on")).toEqual(["two"])
    expect(pendingVmPowerNames(vms, ["one", "two"], "off")).toEqual(["one"])
  })
})

describe("waitForVmPowerConfirmation", () => {
  it("resolves when all VMs reach target state", async () => {
    let calls = 0
    const result = await waitForVmPowerConfirmation({
      rangeId: "DEMO",
      vmNames: ["a"],
      action: "on",
      pollMs: 1,
      timeoutMs: 500,
      fetchStatus: async () => {
        calls += 1
        return { data: { VMs: [vm("a", calls >= 2)] } }
      },
    })
    expect(result.ok).toBe(true)
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it("times out when state never confirms", async () => {
    const result = await waitForVmPowerConfirmation({
      rangeId: "DEMO",
      vmNames: ["a"],
      action: "off",
      pollMs: 1,
      timeoutMs: 20,
      fetchStatus: async () => ({ data: { VMs: [vm("a", true)] } }),
    })
    expect(result).toEqual({ ok: false, via: "timeout", pending: ["a"] })
  })
})
