import { describe, expect, it } from "vitest"
import {
  hrefForGoadRangeSwitch,
  linkedInstanceIdForRange,
  stepGoadRangeFollow,
  type GoadRangeFollow,
} from "@/lib/goad/goad-range-switch"

const empty: GoadRangeFollow = { alignedInstanceId: null, alignedRangeId: null }

describe("stepGoadRangeFollow", () => {
  it("waits until the range list has loaded before aligning or leaving", () => {
    const step = stepGoadRangeFollow(empty, {
      instanceId: "lab-a",
      instanceRangeId: "range-a",
      selectedRangeId: "range-b",
      rangesReady: false,
      instanceRangeListed: false,
    })
    expect(step.selectRangeId).toBeNull()
    expect(step.leaveForRangeId).toBeNull()
    expect(step.state).toEqual(empty)
  })

  it("aligns the sidebar to the lab range and does not leave", () => {
    const step = stepGoadRangeFollow(empty, {
      instanceId: "lab-a",
      instanceRangeId: "range-a",
      selectedRangeId: "range-b",
      rangesReady: true,
      instanceRangeListed: true,
    })
    expect(step.selectRangeId).toBe("range-a")
    expect(step.leaveForRangeId).toBeNull()
    expect(step.state).toEqual({ alignedInstanceId: "lab-a", alignedRangeId: "range-a" })
  })

  it("leaves for a later sidebar choice and does not snap back", () => {
    const aligned: GoadRangeFollow = { alignedInstanceId: "lab-a", alignedRangeId: "range-a" }
    const step = stepGoadRangeFollow(aligned, {
      instanceId: "lab-a",
      instanceRangeId: "range-a",
      selectedRangeId: "range-b",
      rangesReady: true,
      instanceRangeListed: true,
    })
    expect(step.selectRangeId).toBeNull()
    expect(step.leaveForRangeId).toBe("range-b")
    expect(step.state).toEqual(aligned)
  })

  it("stays when the sidebar already matches the lab", () => {
    const aligned: GoadRangeFollow = { alignedInstanceId: "lab-a", alignedRangeId: "range-a" }
    const step = stepGoadRangeFollow(aligned, {
      instanceId: "lab-a",
      instanceRangeId: "range-a",
      selectedRangeId: "range-a",
      rangesReady: true,
      instanceRangeListed: true,
    })
    expect(step.selectRangeId).toBeNull()
    expect(step.leaveForRangeId).toBeNull()
  })

  it("does not leave when the lab range is gone from the list", () => {
    const step = stepGoadRangeFollow(empty, {
      instanceId: "lab-a",
      instanceRangeId: "range-a",
      selectedRangeId: "range-b",
      rangesReady: true,
      instanceRangeListed: false,
    })
    expect(step.selectRangeId).toBeNull()
    expect(step.leaveForRangeId).toBeNull()
    expect(step.state).toEqual(empty)
  })

  it("realigns when the address bar opens a different lab", () => {
    const aligned: GoadRangeFollow = { alignedInstanceId: "lab-a", alignedRangeId: "range-a" }
    const step = stepGoadRangeFollow(aligned, {
      instanceId: "lab-b",
      instanceRangeId: "range-b",
      selectedRangeId: "range-a",
      rangesReady: true,
      instanceRangeListed: true,
    })
    expect(step.selectRangeId).toBe("range-b")
    expect(step.leaveForRangeId).toBeNull()
    expect(step.state.alignedInstanceId).toBe("lab-b")
  })
})

describe("hrefForGoadRangeSwitch", () => {
  it("opens the dashboard when the range has no GOAD lab", () => {
    expect(hrefForGoadRangeSwitch(null)).toBe("/")
    expect(hrefForGoadRangeSwitch("  ")).toBe("/")
  })

  it("opens the GOAD instance linked to the range", () => {
    expect(hrefForGoadRangeSwitch("lab b")).toBe("/goad/lab%20b")
  })
})

describe("linkedInstanceIdForRange", () => {
  const labs = [
    { instanceId: "lab-a", ludusRangeId: "range-a" },
    { instanceId: "lab-b", ludusRangeId: " range-b " },
    { instanceId: "  ", ludusRangeId: "range-c" },
  ]

  it("returns the lab already linked to that range", () => {
    expect(linkedInstanceIdForRange(labs, "range-a")).toBe("lab-a")
    expect(linkedInstanceIdForRange(labs, "range-b")).toBe("lab-b")
  })

  it("returns null when the loaded list has no lab for that range", () => {
    expect(linkedInstanceIdForRange(labs, "range-c")).toBeNull()
    expect(linkedInstanceIdForRange(labs, "range-d")).toBeNull()
    expect(linkedInstanceIdForRange(labs, "  ")).toBeNull()
  })
})