/**
 * Client helper for `/api/range/pb-status`.
 *
 * PocketBase is Ludus's backend data store and is authoritative for persisted
 * range fields (state, testing flag, VM count, allowed domains). The route
 * falls back to the Ludus API when PocketBase is unavailable, so callers also
 * get a source label instead of guessing which store answered.
 */

import { getImpersonationHeaders } from "@/lib/ui/api"
import type { RangeObject } from "@/lib/core/types"

export type RangeStateSource = "pocketbase" | "ludus" | "unknown"

export interface PersistedRangeStatus {
  range: RangeObject | null
  source: RangeStateSource
}

export function findRangeByRangeId(
  list: RangeObject[] | undefined,
  id: string,
): RangeObject | undefined {
  if (!list?.length || !id) return undefined
  const want = id.trim()
  const wantLower = want.toLowerCase()
  return list.find((rd) => {
    const rid = (rd.rangeID ?? (rd as { rangeId?: string }).rangeId ?? "").trim()
    if (!rid) return false
    return rid === want || rid.toLowerCase() === wantLower
  })
}

/** Normalize each range object from API so rangeID / booleans are reliable for the UI. */
export function normalizeRangeListFromApi(raw: unknown): RangeObject[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "result" in raw && Array.isArray((raw as { result?: unknown }).result)
      ? ((raw as { result: unknown[] }).result)
      : []
  const out: RangeObject[] = []
  for (const item of arr) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const rangeID = String(o.rangeID ?? o.rangeId ?? o.RangeID ?? "").trim()
    if (!rangeID) continue
    const testing =
      o.testingEnabled === true || o.testingEnabled === false
        ? Boolean(o.testingEnabled)
        : o.TestingEnabled === true || o.TestingEnabled === false
          ? Boolean(o.TestingEnabled)
          : undefined
    const rawState = o.rangeState ?? o.RangeState
    const rangeState = typeof rawState === "string" && rawState.trim()
      ? rawState as RangeObject["rangeState"]
      : undefined
    const rawCount = o.numberOfVMs ?? o.NumberOfVMs
    const numberOfVMs = rawCount == null || rawCount === "" || Number.isNaN(Number(rawCount))
      ? undefined
      : Number(rawCount)
    const next: RangeObject = { ...(item as RangeObject), rangeID }
    if (testing === undefined) delete next.testingEnabled
    else next.testingEnabled = testing
    if (!rangeState) delete (next as { rangeState?: RangeObject["rangeState"] }).rangeState
    else next.rangeState = rangeState
    if (numberOfVMs === undefined) delete next.numberOfVMs
    else next.numberOfVMs = numberOfVMs
    out.push(next)
  }
  return out
}

function sourceFromHeader(res: Response): RangeStateSource {
  const value = (res.headers.get("x-lux-range-state-source") ?? "").toLowerCase()
  if (value === "pocketbase" || value === "ludus") return value
  return "unknown"
}

export async function fetchPersistedRangeStatus(rangeId: string): Promise<PersistedRangeStatus> {
  if (!rangeId?.trim()) return { range: null, source: "unknown" }
  const res = await fetch(
    `/api/range/pb-status?rangeId=${encodeURIComponent(rangeId)}`,
    { headers: { ...getImpersonationHeaders() } },
  )
  const source = sourceFromHeader(res)
  if (!res.ok) return { range: null, source }
  const data: unknown = await res.json()
  if (data && typeof data === "object" && "error" in data) return { range: null, source }
  const list = normalizeRangeListFromApi(Array.isArray(data) ? data : [data])
  return {
    range: findRangeByRangeId(list, rangeId) ?? list[0] ?? null,
    source,
  }
}

export interface PersistedRangeStatuses {
  ranges: Record<string, RangeObject | null>
  sources: Record<string, RangeStateSource>
}

/**
 * Bulk variant for selector dots. One request for every visible range ID; a
 * missing record is `null` with source `unknown`, not a fabricated empty range.
 */
export async function fetchPersistedRangeStatuses(
  rangeIds: readonly string[],
): Promise<PersistedRangeStatuses> {
  const ids = [...new Set(rangeIds.map((id) => id?.trim()).filter((id): id is string => !!id))]
  if (ids.length === 0) return { ranges: {}, sources: {} }

  const res = await fetch(
    `/api/range/pb-status?rangeIds=${encodeURIComponent(ids.join(","))}`,
    { headers: { ...getImpersonationHeaders() } },
  )
  if (!res.ok) {
    return {
      ranges: Object.fromEntries(ids.map((id) => [id, null])),
      sources: Object.fromEntries(ids.map((id) => [id, "unknown" as const])),
    }
  }

  const body = (await res.json()) as {
    ranges?: Record<string, unknown>
    sources?: Record<string, string>
  }
  const ranges: Record<string, RangeObject | null> = {}
  const sources: Record<string, RangeStateSource> = {}
  for (const id of ids) {
    const raw = body.ranges?.[id]
    const normalized = raw ? normalizeRangeListFromApi([raw])[0] ?? null : null
    ranges[id] = normalized
    const src = (body.sources?.[id] ?? "unknown").toLowerCase()
    sources[id] = src === "pocketbase" || src === "ludus" ? src : "unknown"
  }
  return { ranges, sources }
}
