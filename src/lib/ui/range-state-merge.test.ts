import { describe, expect, it } from "vitest"
import type { RangeObject, VMObject } from "@/lib/core/types"
import { mergePersistedRangeState } from "@/lib/ui/range-state-merge"

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

function makeRange(overrides: Partial<RangeObject> = {}): RangeObject {
  return {
    rangeID: "r1",
    name: "range",
    rangeNumber: 1,
    rangeState: "SUCCESS",
    numberOfVMs: 1,
    testingEnabled: false,
    VMs: [makeVM()],
    ...overrides,
  }
}

describe("mergePersistedRangeState", () => {
  it("returns null when neither source has a range", () => {
    expect(mergePersistedRangeState(null, null, "unknown")).toBeNull()
  })

  it("uses Ludus data when PocketBase is unavailable", () => {
    const ludus = makeRange({ rangeState: "DEPLOYING" })
    const result = mergePersistedRangeState(ludus, null, "ludus")
    expect(result?.range).toBe(ludus)
    expect(result?.persistedStateSource).toBe("ludus")
  })

  it("prefers PocketBase persisted fields but keeps live VMs from Ludus", () => {
    const ludus = makeRange({
      rangeState: "DEPLOYING",
      testingEnabled: false,
      numberOfVMs: 1,
      VMs: [makeVM({ proxmoxID: 100 })],
    })
    const pb = makeRange({
      rangeState: "SUCCESS",
      testingEnabled: true,
      numberOfVMs: 3,
      allowedDomains: ["example.com"],
      VMs: [],
    })

    const result = mergePersistedRangeState(ludus, pb, "pocketbase")
    expect(result?.persistedStateSource).toBe("pocketbase")
    expect(result?.range.rangeState).toBe("SUCCESS")
    expect(result?.range.testingEnabled).toBe(true)
    expect(result?.range.numberOfVMs).toBe(3)
    expect(result?.range.allowedDomains).toEqual(["example.com"])
    expect(result?.range.VMs).toEqual([makeVM({ proxmoxID: 100 })])
  })

  it("does not overwrite Ludus fields with empty PocketBase values", () => {
    const ludus = makeRange({ description: "from ludus", allowedDomains: ["ludus.example"] })
    const pb = makeRange({ description: "", allowedDomains: undefined })
    const result = mergePersistedRangeState(ludus, pb, "pocketbase")
    expect(result?.range.description).toBe("from ludus")
    expect(result?.range.allowedDomains).toEqual(["ludus.example"])
  })

  it("uses PocketBase alone when Ludus has no range body", () => {
    const pb = makeRange({ rangeState: "SUCCESS", numberOfVMs: 2 })
    const result = mergePersistedRangeState(null, pb, "pocketbase")
    expect(result?.range.rangeID).toBe("r1")
    expect(result?.range.VMs).toEqual([])
    expect(result?.persistedStateSource).toBe("pocketbase")
  })
})
