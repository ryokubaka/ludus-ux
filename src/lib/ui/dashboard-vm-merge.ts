import type { RangeObject, VMObject } from "@/lib/core/types"

/** Proxmox VMID. Ludus sometimes puts it on `proxmoxID` and sometimes on `ID` with the other field 0. */
export function vmProxmoxVmid(vm: VMObject): number {
  const proxmox = Number(vm.proxmoxID)
  if (Number.isFinite(proxmox) && proxmox > 0) return proxmox
  const id = Number(vm.ID)
  if (Number.isFinite(id) && id > 0) return id
  return 0
}

export function vmNameKey(vm: VMObject): string {
  return (vm.name || vm.vmName || "").toString().trim().toLowerCase()
}

/** Stable row identity. One key per Proxmox VMID. A row with no VMID is keyed by name. */
export function vmIdentityKey(vm: VMObject): string {
  const vmid = vmProxmoxVmid(vm)
  if (vmid > 0) return `p:${vmid}`
  const name = vmNameKey(vm)
  return name ? `n:${name}` : `z:${JSON.stringify([vm.ID, vm.proxmoxID, vm.name])}`
}

function vmRowScore(vm: VMObject): number {
  const ip = typeof vm.ip === "string" ? vm.ip.trim() : ""
  return (ip && ip !== "-" ? 2 : 0) + (Number(vm.proxmoxID) > 0 ? 1 : 0)
}

/** Drop repeated VMIDs, and drop a nameless placeholder once a row with that name has a VMID. */
export function dedupeVMs(vms: VMObject[]): VMObject[] {
  const byKey = new Map<string, VMObject>()
  for (const vm of vms) {
    const key = vmIdentityKey(vm)
    const prev = byKey.get(key)
    if (!prev || vmRowScore(vm) >= vmRowScore(prev)) byKey.set(key, vm)
  }
  const rows = Array.from(byKey.values())
  const namedWithVmid = new Set(
    rows.map((vm) => (vmProxmoxVmid(vm) > 0 ? vmNameKey(vm) : "")).filter(Boolean),
  )
  return rows.filter((vm) => {
    if (vmProxmoxVmid(vm) > 0) return true
    const name = vmNameKey(vm)
    return !name || !namedWithVmid.has(name)
  })
}

/**
 * Union merge for partial Ludus VM lists. When `stalePowerPessimistic`, VMs that
 * exist only in `prev` (omitted from this poll's `next`) get poweredOff so the
 * dashboard "Running" count and badges do not show ghost online state.
 */
export function mergeVmUnionPreferNext(
  prev: VMObject[],
  next: VMObject[],
  stalePowerPessimistic: boolean,
): VMObject[] {
  const nextKeys = new Set(next.map(vmIdentityKey))
  const m = new Map<string, VMObject>()
  for (const vm of prev) {
    const k = vmIdentityKey(vm)
    let row = vm
    if (stalePowerPessimistic && !nextKeys.has(k)) {
      row = { ...vm, poweredOn: false, powerState: "stopped" }
    }
    m.set(k, row)
  }
  for (const vm of next) m.set(vmIdentityKey(vm), vm)
  return dedupeVMs(Array.from(m.values()))
}

function incomingVmSignature(vms: VMObject[]): string {
  return vms.map(vmIdentityKey).sort().join("|")
}

/** Match vm-table: explicit `poweredOn: false` wins over a stale `powerState`. */
export function vmIsRunning(vm: VMObject): boolean {
  return vm.poweredOn ?? (vm.powerState === "running")
}

function nextVmKeysAreSubsetOfPrev(next: VMObject[], prev: VMObject[]): boolean {
  if (next.length === 0 || prev.length === 0) return false
  const prevKeys = new Set(prev.map(vmIdentityKey))
  return next.every((vm) => prevKeys.has(vmIdentityKey(vm)))
}

const vmPartialListStreak = new Map<string, { signature: string; streak: number }>()

function vmPartialStreakKey(scopeTag: string, rangeId: string) {
  return `${scopeTag}::${rangeId}`
}

export function clearVmPartialListStreak(): void {
  vmPartialListStreak.clear()
}

/**
 * When GET /range returns fewer VM rows than we already had (or than numberOfVMs says exist),
 * one poll is merged with the previous list so a Proxmox hiccup does not hide VMs.
 * The same short snapshot on the next poll replaces the cache. A list at least as long as
 * numberOfVMs is shown as-is. Rows that share a Proxmox VMID, or a name with no VMID beside
 * a named row that has one, collapse to a single row.
 */
export function resolveVmListForRangeQuery(args: {
  data: RangeObject
  newVMs: VMObject[]
  prevVMs: VMObject[]
  stateUpper: string
  scopeTag: string
  rangeId: string
}): VMObject[] {
  const { data, newVMs, prevVMs, stateUpper, scopeTag, rangeId } = args
  const transientVmGap = stateUpper === "DEPLOYING" || stateUpper === "WAITING"
  const streakKey = vmPartialStreakKey(scopeTag, rangeId)

  const expected =
    typeof data.numberOfVMs === "number" && Number.isFinite(data.numberOfVMs) && data.numberOfVMs >= 0
      ? data.numberOfVMs
      : undefined

  if (newVMs.length === 0) {
    if (prevVMs.length > 0 && transientVmGap) {
      vmPartialListStreak.delete(streakKey)
      return dedupeVMs(prevVMs)
    }
    if (prevVMs.length > 0) {
      const signature = "empty"
      const row = vmPartialListStreak.get(streakKey)
      if (row && row.signature === signature) row.streak += 1
      else vmPartialListStreak.set(streakKey, { signature, streak: 1 })
      const streak = vmPartialListStreak.get(streakKey)!.streak
      if (streak >= 2) {
        vmPartialListStreak.delete(streakKey)
        return []
      }
      return dedupeVMs(prevVMs)
    }
    vmPartialListStreak.delete(streakKey)
    return []
  }

  const listed = dedupeVMs(newVMs)

  // numberOfVMs is the range record's count, not a promise that this payload is partial.
  // A list at least that long is the snapshot to show. A longer list is extra clones, not ghosts.
  if (expected !== undefined && listed.length >= expected) {
    vmPartialListStreak.delete(streakKey)
    return listed
  }

  const signature = incomingVmSignature(listed)
  const row = vmPartialListStreak.get(streakKey)
  if (row && row.signature === signature) row.streak += 1
  else vmPartialListStreak.set(streakKey, { signature, streak: 1 })
  const streak = vmPartialListStreak.get(streakKey)!.streak

  const shorterThanExpected = expected !== undefined && listed.length < expected
  const shorterThanPrev =
    prevVMs.length > 0 &&
    listed.length < prevVMs.length &&
    nextVmKeysAreSubsetOfPrev(listed, prevVMs)

  if (shorterThanExpected || shorterThanPrev) {
    // One short poll can be a Proxmox hiccup. The same short snapshot twice is the real list.
    if (streak >= 2) {
      vmPartialListStreak.delete(streakKey)
      return listed
    }
    return dedupeVMs(mergeVmUnionPreferNext(prevVMs, listed, true))
  }

  vmPartialListStreak.delete(streakKey)
  return listed
}
