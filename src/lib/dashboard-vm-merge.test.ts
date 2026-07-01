import { describe, expect, it, afterEach } from "vitest"
import type { VMObject } from "./types"
import {
  vmIdentityKey,
  dedupeVMs,
  mergeVmUnionPreferNext,
  vmIsRunning,
  clearVmPartialListStreak,
  resolveVmListForRangeQuery,
} from "./dashboard-vm-merge"

function makeVM(overrides: Partial<VMObject> = {}): VMObject {
  return {
    ID: 1,
    proxmoxID: 100,
    rangeNumber: 1,
    name: "test-vm",
    poweredOn: true,
    ip: "10.0.0.1",
    ...overrides,
  }
}

afterEach(() => {
  clearVmPartialListStreak()
})

describe("vmIdentityKey", () => {
  it("prefers proxmoxID", () => {
    expect(vmIdentityKey(makeVM({ proxmoxID: 42 }))).toBe("p:42")
  })

  it("falls back to ID when proxmoxID is 0", () => {
    expect(vmIdentityKey(makeVM({ proxmoxID: 0, ID: 5 }))).toBe("i:5")
  })

  it("falls back to name when both IDs are 0", () => {
    expect(vmIdentityKey(makeVM({ proxmoxID: 0, ID: 0, name: "MyVM" }))).toBe("n:myvm")
  })

  it("produces deterministic fallback for no identifying info", () => {
    const key = vmIdentityKey(makeVM({ proxmoxID: 0, ID: 0, name: "" }))
    expect(key).toMatch(/^z:/)
  })
})

describe("dedupeVMs", () => {
  it("removes duplicate VMs by identity key", () => {
    const vms = [makeVM({ proxmoxID: 1 }), makeVM({ proxmoxID: 1 }), makeVM({ proxmoxID: 2 })]
    expect(dedupeVMs(vms)).toHaveLength(2)
  })

  it("keeps all when no duplicates", () => {
    const vms = [makeVM({ proxmoxID: 1 }), makeVM({ proxmoxID: 2 })]
    expect(dedupeVMs(vms)).toHaveLength(2)
  })
})

describe("mergeVmUnionPreferNext", () => {
  it("prefers next over prev for same identity", () => {
    const prev = [makeVM({ proxmoxID: 1, ip: "10.0.0.1" })]
    const next = [makeVM({ proxmoxID: 1, ip: "10.0.0.2" })]
    const result = mergeVmUnionPreferNext(prev, next, false)
    expect(result[0].ip).toBe("10.0.0.2")
  })

  it("marks stale VMs as powered off with stalePowerPessimistic", () => {
    const prev = [makeVM({ proxmoxID: 1, poweredOn: true })]
    const next: VMObject[] = []
    const result = mergeVmUnionPreferNext(prev, next, true)
    expect(result[0].poweredOn).toBe(false)
  })

  it("merges VMs from both lists", () => {
    const prev = [makeVM({ proxmoxID: 1 })]
    const next = [makeVM({ proxmoxID: 2 })]
    const result = mergeVmUnionPreferNext(prev, next, false)
    expect(result).toHaveLength(2)
  })
})

describe("vmIsRunning", () => {
  it("returns true when poweredOn is true", () => {
    expect(vmIsRunning(makeVM({ poweredOn: true }))).toBe(true)
  })

  it("returns false when poweredOn is false", () => {
    expect(vmIsRunning(makeVM({ poweredOn: false }))).toBe(false)
  })

  it("falls back to powerState when poweredOn is undefined", () => {
    const vm: Record<string, unknown> = { ...makeVM() }
    delete vm.poweredOn
    vm.powerState = "running"
    expect(vmIsRunning(vm as unknown as VMObject)).toBe(true)
  })
})

describe("resolveVmListForRangeQuery", () => {
  it("returns newVMs when count matches numberOfVMs", () => {
    const newVMs = [makeVM({ proxmoxID: 1 }), makeVM({ proxmoxID: 2 })]
    const result = resolveVmListForRangeQuery({
      data: { rangeID: "r1", name: "test", rangeNumber: 1, rangeState: "SUCCESS", VMs: newVMs, numberOfVMs: 2 },
      newVMs,
      prevVMs: [],
      stateUpper: "SUCCESS",
      scopeTag: "user|self",
      rangeId: "r1",
    })
    expect(result).toEqual(newVMs)
  })

  it("merges when newVMs count is less than numberOfVMs", () => {
    const prev = [makeVM({ proxmoxID: 1 }), makeVM({ proxmoxID: 2 })]
    const next = [makeVM({ proxmoxID: 1 })]
    const result = resolveVmListForRangeQuery({
      data: { rangeID: "r1", name: "test", rangeNumber: 1, rangeState: "SUCCESS", VMs: next, numberOfVMs: 2 },
      newVMs: next,
      prevVMs: prev,
      stateUpper: "SUCCESS",
      scopeTag: "user|self",
      rangeId: "r1",
    })
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it("keeps prev VMs during transient gap when DEPLOYING and newVMs is empty", () => {
    const prev = [makeVM({ proxmoxID: 1 })]
    const result = resolveVmListForRangeQuery({
      data: { rangeID: "r1", name: "test", rangeNumber: 1, rangeState: "DEPLOYING", VMs: [] },
      newVMs: [],
      prevVMs: prev,
      stateUpper: "DEPLOYING",
      scopeTag: "user|self",
      rangeId: "r1",
    })
    expect(result).toEqual(prev)
  })

  it("returns [] when newVMs is empty and not deploying", () => {
    const result = resolveVmListForRangeQuery({
      data: { rangeID: "r1", name: "test", rangeNumber: 1, rangeState: "SUCCESS", VMs: [] },
      newVMs: [],
      prevVMs: [],
      stateUpper: "SUCCESS",
      scopeTag: "user|self",
      rangeId: "r1",
    })
    expect(result).toEqual([])
  })
})
