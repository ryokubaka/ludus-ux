/**
 * Compose the dashboard range snapshot.
 *
 * Persisted range fields (state, testing flag, VM count, allowed domains) come
 * from PocketBase, Ludus's backend store. Live VM inventory is not persisted
 * there and still comes from the Ludus `/range` response. The two are merged
 * explicitly so the UI can label which store supplied the persisted fields.
 */

import type { RangeObject } from "@/lib/core/types"
import type { RangeStateSource } from "@/lib/ui/range-pb-status"

export interface MergedRangeSnapshot {
  range: RangeObject
  /** Store that supplied the persisted fields in this snapshot. */
  persistedStateSource: RangeStateSource
}

/** Fields PocketBase persists; live VM inventory is intentionally excluded. */
const PERSISTED_FIELDS = [
  "rangeState",
  "testingEnabled",
  "numberOfVMs",
  "allowedDomains",
  "allowedIPs",
  "name",
  "description",
  "purpose",
  "rangeNumber",
  "userID",
  "lastDeployment",
] as const

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "")
}

export function mergePersistedRangeState(
  ludus: RangeObject | null,
  persisted: RangeObject | null,
  persistedSource: RangeStateSource,
): MergedRangeSnapshot | null {
  if (!ludus && !persisted) return null

  if (!ludus) {
    return {
      range: { ...persisted!, VMs: [] },
      persistedStateSource: persistedSource,
    }
  }

  if (!persisted) {
    return { range: ludus, persistedStateSource: "ludus" }
  }

  const merged: RangeObject = { ...ludus, VMs: ludus.VMs ?? [] }
  for (const field of PERSISTED_FIELDS) {
    const value = persisted[field]
    if (!hasValue(value)) continue
    // Fields have compatible types on RangeObject; this loop only copies the
    // persisted allowlist and never touches VMs.
    ;(merged as unknown as Record<string, unknown>)[field] = value
  }

  return { range: merged, persistedStateSource: persistedSource }
}
