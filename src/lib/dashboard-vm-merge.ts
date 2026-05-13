import type { RangeObject, VMObject } from "@/lib/types"

/** Stable row identity for merge/dedupe (Proxmox ID preferred, then Ludus VM ID, then name). */
export function vmIdentityKey(vm: VMObject): string {
  const p = vm.proxmoxID
  if (p != null && Number(p) !== 0) return `p:${Number(p)}`
  const id = vm.ID
  if (id != null && Number(id) !== 0) return `i:${Number(id)}`
  const n = (vm.name || vm.vmName || "").toString().trim().toLowerCase()
  return n ? `n:${n}` : `z:${JSON.stringify([vm.ID, vm.proxmoxID, vm.name])}`
}

export function dedupeVMs(vms: VMObject[]): VMObject[] {
  const seen = new Set<string>()
  return vms.filter((vm) => {
    const key = vmIdentityKey(vm)
    if (seen.has(key)) return false
    seen.add(key)
    return true
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
 * Ludus/Proxmox sometimes omits rows on a single poll. Merge with cache so refresh does not
 * hide VMs. When numberOfVMs matches the new list length, treat the list as authoritative.
 * When numberOfVMs is absent but the same short list repeats twice, trust the shrink.
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
    vmPartialListStreak.delete(streakKey)
    if (prevVMs.length > 0 && transientVmGap) return prevVMs
    return []
  }

  if (expected !== undefined && expected === newVMs.length) {
    vmPartialListStreak.delete(streakKey)
    return newVMs
  }

  if (expected !== undefined && newVMs.length < expected) {
    vmPartialListStreak.delete(streakKey)
    return mergeVmUnionPreferNext(prevVMs, newVMs, true)
  }

  if (
    prevVMs.length > 0 &&
    newVMs.length < prevVMs.length &&
    nextVmKeysAreSubsetOfPrev(newVMs, prevVMs)
  ) {
    const signature = newVMs
      .map(vmIdentityKey)
      .sort()
      .join("|")
    const row = vmPartialListStreak.get(streakKey)
    if (row && row.signature === signature) row.streak += 1
    else vmPartialListStreak.set(streakKey, { signature, streak: 1 })
    const streak = vmPartialListStreak.get(streakKey)!.streak
    if (streak >= 2) {
      vmPartialListStreak.delete(streakKey)
      return newVMs
    }
    return mergeVmUnionPreferNext(prevVMs, newVMs, true)
  }

  vmPartialListStreak.delete(streakKey)
  return newVMs
}
