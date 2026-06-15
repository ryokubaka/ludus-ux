import { describe, expect, it } from "vitest"
import { buildSnapshotsViewData } from "./snapshots-view-data"
import type { SnapshotInfo } from "./types"

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
})
