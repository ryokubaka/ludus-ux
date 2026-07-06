import { describe, expect, it } from "vitest"
import { buildSnapshotsViewData, emptySnapshotsViewData } from "./snapshots-view-data"
import type { SnapshotInfo } from "./types"

function makeSnap(overrides: Partial<SnapshotInfo> = {}): SnapshotInfo {
  return { name: "snap1", vmid: 100, vmname: "dc01", snaptime: 1700000000, ...overrides }
}

describe("emptySnapshotsViewData", () => {
  it("returns empty groups", () => {
    const data = emptySnapshotsViewData()
    expect(data.vmGroups).toEqual([])
    expect(data.snapGroups).toEqual([])
  })

  it("passes unsupported flag", () => {
    expect(emptySnapshotsViewData(true).snapshotsUnsupported).toBe(true)
  })
})

describe("buildSnapshotsViewData", () => {
  it("groups by VM and snapshot name", () => {
    const flat: SnapshotInfo[] = [
      { name: "current", vmname: "dc", vmid: 1, parent: "snap-a" },
      { name: "snap-a", vmname: "dc", vmid: 1, snaptime: 100, includesRAM: true },
      { name: "snap-a", vmname: "ws", vmid: 2, snaptime: 90, includesRAM: false },
    ]
    const view = buildSnapshotsViewData(flat)
    expect(view.vmGroups).toHaveLength(2)
    expect(view.snapGroups).toHaveLength(1)
    expect(view.snapGroups[0].vms).toHaveLength(2)
  })

  it("groups snapshots by VM", () => {
    const snaps = [
      makeSnap({ name: "snap1", vmname: "dc01", vmid: 100 }),
      makeSnap({ name: "snap2", vmname: "dc01", vmid: 100 }),
      makeSnap({ name: "snap1", vmname: "ws01", vmid: 101 }),
    ]
    const data = buildSnapshotsViewData(snaps)
    expect(data.vmGroups).toHaveLength(2)
    const dc01 = data.vmGroups.find((g) => g.vmname === "dc01")
    expect(dc01?.snapshots).toHaveLength(2)
  })

  it("handles 'current' snapshot entries", () => {
    const snaps = [
      makeSnap({ name: "current", parent: "snap1", vmname: "dc01" }),
      makeSnap({ name: "snap1", vmname: "dc01" }),
    ]
    const data = buildSnapshotsViewData(snaps)
    const dc01 = data.vmGroups.find((g) => g.vmname === "dc01")
    expect(dc01?.currentSnapshot).toBe("snap1")
    expect(dc01?.snapshots).toHaveLength(1)
  })

  it("excludes 'current' from snap name groups", () => {
    const snaps = [
      makeSnap({ name: "current", parent: "snap1", vmname: "dc01" }),
      makeSnap({ name: "snap1", vmname: "dc01" }),
    ]
    const data = buildSnapshotsViewData(snaps)
    expect(data.snapGroups.find((g) => g.name === "current")).toBeUndefined()
  })

  it("sorts VM snapshots by snaptime descending", () => {
    const snaps = [
      makeSnap({ name: "older", vmname: "dc01", snaptime: 1000 }),
      makeSnap({ name: "newer", vmname: "dc01", snaptime: 2000 }),
    ]
    const data = buildSnapshotsViewData(snaps)
    const dc01 = data.vmGroups.find((g) => g.vmname === "dc01")
    expect(dc01?.snapshots[0].name).toBe("newer")
  })

  it("handles empty input", () => {
    const data = buildSnapshotsViewData([])
    expect(data.vmGroups).toEqual([])
    expect(data.snapGroups).toEqual([])
  })

  it("uses vmid fallback key when vmname is missing", () => {
    const snaps = [makeSnap({ vmname: undefined, vmid: 200, name: "snap1" })]
    const data = buildSnapshotsViewData(snaps)
    expect(data.vmGroups[0].vmname).toBe("vm-200")
  })

  it("picks earliest snaptime for snap group", () => {
    const snaps = [
      makeSnap({ name: "snap1", vmname: "dc01", snaptime: 2000 }),
      makeSnap({ name: "snap1", vmname: "ws01", snaptime: 1000 }),
    ]
    const data = buildSnapshotsViewData(snaps)
    const group = data.snapGroups.find((g) => g.name === "snap1")
    expect(group?.snaptime).toBe(1000)
  })
})
