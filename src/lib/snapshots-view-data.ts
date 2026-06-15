import type { SnapshotInfo } from "@/lib/types"

export interface SnapshotsVmGroup {
  vmname: string
  vmid?: number
  currentSnapshot?: string
  snapshots: SnapshotInfo[]
}

export interface SnapshotsNameGroup {
  name: string
  description?: string
  includesRAM: boolean
  snaptime?: number
  vms: SnapshotInfo[]
}

export interface SnapshotsViewData {
  vmGroups: SnapshotsVmGroup[]
  snapGroups: SnapshotsNameGroup[]
  snapshotsUnsupported?: boolean
}

export function emptySnapshotsViewData(unsupported?: boolean): SnapshotsViewData {
  return { vmGroups: [], snapGroups: [], snapshotsUnsupported: unsupported }
}

/** Same grouping logic as the Snapshots page TanStack queryFn. */
export function buildSnapshotsViewData(flat: SnapshotInfo[]): SnapshotsViewData {
  const vmMap = new Map<string, SnapshotsVmGroup>()
  for (const snap of flat) {
    const key = snap.vmname ?? `vm-${snap.vmid}`
    if (!vmMap.has(key)) vmMap.set(key, { vmname: key, vmid: snap.vmid, snapshots: [] })
    const group = vmMap.get(key)!
    if (snap.name === "current") group.currentSnapshot = snap.parent
    else group.snapshots.push(snap)
  }
  const vmGroups = Array.from(vmMap.values()).map((g) => ({
    ...g,
    snapshots: g.snapshots.sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0)),
  }))

  const snapMap = new Map<string, SnapshotsNameGroup>()
  for (const snap of flat) {
    if (snap.name === "current") continue
    const existing = snapMap.get(snap.name)
    if (existing) {
      existing.vms.push(snap)
      if (snap.snaptime && (!existing.snaptime || snap.snaptime < existing.snaptime)) {
        existing.snaptime = snap.snaptime
      }
    } else {
      snapMap.set(snap.name, {
        name: snap.name,
        description: snap.description,
        includesRAM: snap.includesRAM ?? false,
        snaptime: snap.snaptime,
        vms: [snap],
      })
    }
  }
  const snapGroups = Array.from(snapMap.values()).sort(
    (a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0),
  )
  return { vmGroups, snapGroups, snapshotsUnsupported: false }
}
