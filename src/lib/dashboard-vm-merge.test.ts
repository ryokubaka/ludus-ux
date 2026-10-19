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

  it("uses ID as the VMID when proxmoxID is 0", () => {
    expect(vmIdentityKey(makeVM({ proxmoxID: 0, ID: 5 }))).toBe("p:5")
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

  it("collapses the same VMID whether it arrived as proxmoxID or ID", () => {
    const name = "lab-router-debian11-x64"
    const vms = [
      makeVM({ name, proxmoxID: 144, ID: 0, ip: "10.1.10.254" }),
      makeVM({ name, proxmoxID: 144, ID: 144, ip: "10.1.10.254" }),
      makeVM({ name, proxmoxID: 0, ID: 144, ip: "" }),
    ]
    const result = dedupeVMs(vms)
    expect(result).toHaveLength(1)
    expect(result[0].ip).toBe("10.1.10.254")
  })

  it("keeps two clones that share a name and have different VMIDs", () => {
    const name = "lab-router-debian11-x64"
    const result = dedupeVMs([
      makeVM({ name, proxmoxID: 144, ip: "10.1.10.254" }),
      makeVM({ name, proxmoxID: 255, ip: "" }),
    ])
    expect(result.map((vm) => vm.proxmoxID).sort()).toEqual([144, 255])
  })

  it("drops a name-only placeholder once that name has a VMID", () => {
    const name = "lab-router-debian11-x64"
    const result = dedupeVMs([
      makeVM({ name, proxmoxID: 0, ID: 0, ip: "" }),
      makeVM({ name, proxmoxID: 144, ID: 0, ip: "10.1.10.254" }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].proxmoxID).toBe(144)
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

  it("shows a full poll immediately after a one-VM first paint", () => {
    const router = "lab-router-debian11-x64"
    const first = [makeVM({ name: router, proxmoxID: 0, ID: 0, ip: "" })]
    const full = [
      makeVM({ name: router, proxmoxID: 144, ID: 0, ip: "10.1.10.254" }),
      makeVM({ name: "dc01", proxmoxID: 169, ID: 0 }),
      makeVM({ name: "lx01", proxmoxID: 217, ID: 0 }),
      makeVM({ name: router, proxmoxID: 255, ID: 0, ip: "" }),
      makeVM({ name: "srv01", proxmoxID: 211, ID: 0 }),
    ]
    const base = {
      data: {
        rangeID: "r1",
        name: "test",
        rangeNumber: 1,
        rangeState: "ERROR" as const,
        VMs: full,
        numberOfVMs: 5,
      },
      stateUpper: "ERROR",
      scopeTag: "user|self",
      rangeId: "r1",
    }
    const painted = resolveVmListForRangeQuery({ ...base, data: { ...base.data, VMs: first }, newVMs: first, prevVMs: [] })
    expect(painted).toHaveLength(1)
    const settled = resolveVmListForRangeQuery({ ...base, newVMs: full, prevVMs: painted })
    expect(settled.map((vm) => vm.proxmoxID).sort((a, b) => a - b)).toEqual([144, 169, 211, 217, 255])
  })

  it("trusts a repeated short list instead of growing the cache", () => {
    const only = [makeVM({ proxmoxID: 144, name: "router" })]
    const prev = [makeVM({ proxmoxID: 144, name: "router" }), makeVM({ proxmoxID: 169, name: "dc" })]
    const args = {
      data: { rangeID: "r1", name: "test", rangeNumber: 1, rangeState: "SUCCESS" as const, VMs: only, numberOfVMs: 5 },
      newVMs: only,
      prevVMs: prev,
      stateUpper: "SUCCESS",
      scopeTag: "user|self",
      rangeId: "r-short",
    }
    expect(resolveVmListForRangeQuery(args)).toHaveLength(2)
    expect(resolveVmListForRangeQuery(args)).toEqual(only)
  })

  it("keeps prev VMs on first empty SUCCESS poll, clears on second", () => {
    const prev = [makeVM({ proxmoxID: 1 }), makeVM({ proxmoxID: 2 })]
    const base = {
      data: {
        rangeID: "r1",
        name: "test",
        rangeNumber: 1,
        rangeState: "SUCCESS" as const,
        VMs: [] as VMObject[],
        numberOfVMs: 2,
      },
      newVMs: [] as VMObject[],
      prevVMs: prev,
      stateUpper: "SUCCESS",
      scopeTag: "user|self",
      rangeId: "r1",
    }
    expect(resolveVmListForRangeQuery(base)).toEqual(prev)
    expect(resolveVmListForRangeQuery(base)).toEqual([])
  })
})
