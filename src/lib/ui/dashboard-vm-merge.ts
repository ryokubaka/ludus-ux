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

/**
 * One short poll can be a Proxmox hiccup. Bound how long we retain rows that
 * the authoritative payload did not confirm, including alternating short
 * snapshots and DEPLOYING/WAITING gaps where `numberOfVMs` is still 0.
 */
const MAX_UNCONFIRMED_MERGES = 2

interface VmPartialListState {
  signature: string
  streak: number
  merges: number
}

const vmPartialListStreak = new Map<string, VmPartialListState>()

function vmPartialStreakKey(scopeTag: string, rangeId: string) {
  return `${scopeTag}::${rangeId}`
}

export function clearVmPartialListStreak(): void {
  vmPartialListStreak.clear()
}

/** Result of resolving a Ludus VM list for the dashboard table. */
export interface VmListResolution {
  vms: VMObject[]
  /**
   * Identity keys of rows that came from the previous poll and were not in the
   * current payload. They are shown while a refresh is in progress but must be
   * labeled as unconfirmed.
   */
  unconfirmedVmKeys: string[]
  /** True when the result contains at least one row not confirmed by this poll. */
  merged: boolean
}

function resolution(
  vms: VMObject[],
  confirmedKeys: Set<string>,
): VmListResolution {
  const unconfirmedVmKeys = vms
    .map(vmIdentityKey)
    .filter((key) => !confirmedKeys.has(key))
  return {
    vms,
    unconfirmedVmKeys,
    merged: unconfirmedVmKeys.length > 0,
  }
}

function nextStreak(
  streakKey: string,
  signature: string,
  merge: boolean,
): VmPartialListState {
  const row = vmPartialListStreak.get(streakKey)
  const next: VmPartialListState = {
    signature,
    streak: row && row.signature === signature ? row.streak + 1 : 1,
    merges: merge ? (row?.merges ?? 0) + 1 : 0,
  }
  vmPartialListStreak.set(streakKey, next)
  return next
}

/**
 * Resolve the VM list for a dashboard poll.
 *
 * A verified payload (at least `numberOfVMs` rows, or a list that is not
 * shorter than the previous one) replaces the table immediately. A short
 * payload is merged with the previous list at most `MAX_UNCONFIRMED_MERGES`
 * times; rows retained from the previous poll are returned as unconfirmed.
 * After the merge budget or a repeated identical short snapshot, the payload
 * is treated as authoritative so stale rows cannot accumulate indefinitely.
 */
export function resolveVmListForRangeQuery(args: {
  data: RangeObject
  newVMs: VMObject[]
  prevVMs: VMObject[]
  stateUpper: string
  scopeTag: string
  rangeId: string
}): VmListResolution {
  const { data, newVMs, prevVMs, scopeTag, rangeId } = args
  const streakKey = vmPartialStreakKey(scopeTag, rangeId)

  // A missing count, or an explicit 0 from a store that defaulted an absent field,
  // is not proof that this payload is complete.
  const expected =
    typeof data.numberOfVMs === "number" && Number.isFinite(data.numberOfVMs) && data.numberOfVMs > 0
      ? data.numberOfVMs
      : undefined

  if (newVMs.length === 0) {
    if (prevVMs.length === 0) {
      vmPartialListStreak.delete(streakKey)
      return resolution([], new Set())
    }

    const row = nextStreak(streakKey, "empty", true)
    if (row.streak >= 2 || row.merges > MAX_UNCONFIRMED_MERGES) {
      vmPartialListStreak.delete(streakKey)
      return resolution([], new Set())
    }

    const kept = dedupeVMs(prevVMs)
    return resolution(kept, new Set())
  }

  const listed = dedupeVMs(newVMs)
  const listedKeys = new Set(listed.map(vmIdentityKey))

  // numberOfVMs is the range record's count, not a promise that this payload is partial.
  // A list at least that long is the snapshot to show. A longer list is extra clones, not ghosts.
  if (expected !== undefined && listed.length >= expected) {
    vmPartialListStreak.delete(streakKey)
    return resolution(listed, listedKeys)
  }

  const shorterThanExpected = expected !== undefined && listed.length < expected
  const shorterThanPrev =
    prevVMs.length > 0 &&
    listed.length < prevVMs.length &&
    nextVmKeysAreSubsetOfPrev(listed, prevVMs)

  if (!shorterThanExpected && !shorterThanPrev) {
    vmPartialListStreak.delete(streakKey)
    return resolution(listed, listedKeys)
  }

  const row = nextStreak(streakKey, incomingVmSignature(listed), true)

  // The same short snapshot twice, or a merge budget that is exhausted, means
  // this is the authoritative list. Trust it instead of growing the cache.
  if (row.streak >= 2 || row.merges > MAX_UNCONFIRMED_MERGES) {
    vmPartialListStreak.delete(streakKey)
    return resolution(listed, listedKeys)
  }

  const merged = dedupeVMs(mergeVmUnionPreferNext(prevVMs, listed, true))
  return resolution(merged, listedKeys)
}
