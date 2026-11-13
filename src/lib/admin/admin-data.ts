/**
 * Shared admin data fetcher used by both:
 *   - /api/admin/ranges-data  (the API route)
 *   - app/admin/page.tsx      (server-side SSR prefetch)
 *
 * Fast path  — PocketBase (direct DB read, 2 parallel requests):
 *   Requires LUDUS_ROOT_API_KEY.  Returns ranges + users with ownership
 *   already embedded in each range's `userID` field.  No per-range API
 *   calls needed, so the response time is O(1) regardless of range count.
 *
 * Slow path  — Ludus API (used when PocketBase is unavailable / misconfigured):
 *   GET /range/all  +  GET /user/all  +  up to 30× GET /range?rangeID=X
 *   for ownership resolution. Detail lookups run with bounded concurrency and
 *   unresolved ranges are reported in `partial` so the admin page can show a
 *   partial-data notice instead of pretending the list is complete.
 *
 * Ownership resolution priority (highest → lowest):
 *   1. SQLite range_ownership table  (admin-confirmed, survives restarts)
 *   2. range.userID from PocketBase (or GET /range/all)
 *   3. range.rangeID === user.userID  (Ludus primary-range convention)
 *   4. user.defaultRangeID / user.rangeID
 *   5. Individual GET /range?rangeID=X  (slow path only; PB path skips this)
 */

import { ludusRequest } from "@/lib/ludus/ludus-client"
import { mapWithConcurrency } from "@/lib/core/concurrency"
import { dedupeVMs, mergeVmUnionPreferNext } from "@/lib/ui/dashboard-vm-merge"
import { getAllOwnership } from "@/lib/range/range-ownership-store"
import { fetchPbAdminData } from "@/lib/core/pocketbase-client"
import type { RangeObject, UserObject, VMObject } from "@/lib/core/types"
import { extractArray } from "@/lib/core/utils"

export interface AdminDataPartial {
  /** Ranges whose owner could not be resolved in this read. */
  unresolvedRangeIDs: string[]
  /** True when the per-range detail lookup cap skipped some unresolved ranges. */
  truncated: boolean
}

export interface AdminData {
  ranges: RangeObject[]
  users: UserObject[]
  ownership: Record<string, string>
  ts: number
  /** Present only when the slow path could not resolve every owner. */
  partial?: AdminDataPartial
}

import { SWRCache } from "@/lib/core/server-cache"
import { revalidateLudusAdminMutation } from "@/lib/ludus/ludus-cache-revalidate"

const _swrCache = new SWRCache<AdminData>(30_000)

function adminCacheKey(apiKey: string): string {
  return `admin:${apiKey.trim()}`
}

export function bustAdminCache(apiKey?: string): void {
  if (apiKey?.trim()) {
    _swrCache.invalidate(adminCacheKey(apiKey))
  } else {
    _swrCache.invalidate()
  }
  revalidateLudusAdminMutation()
}

/** Prefer PocketBase VMs when Ludus returns an empty or short /range/all slice. */
function mergeAdminRangeVms(pbRange: RangeObject, ludusVms: VMObject[] | undefined): VMObject[] {
  const prev = dedupeVMs(pbRange.VMs || [])
  if (ludusVms === undefined) return prev

  const next = dedupeVMs(ludusVms)
  const expected =
    typeof pbRange.numberOfVMs === "number" &&
    Number.isFinite(pbRange.numberOfVMs) &&
    pbRange.numberOfVMs >= 0
      ? pbRange.numberOfVMs
      : undefined

  if (next.length === 0) {
    if (prev.length > 0 && (expected === undefined || expected > 0)) return prev
    return []
  }

  if (expected !== undefined && next.length < expected) {
    return mergeVmUnionPreferNext(prev, next, true)
  }

  if (prev.length > 0 && next.length < prev.length) {
    return mergeVmUnionPreferNext(prev, next, true)
  }

  return next
}

// ── Ownership resolution (shared by both paths) ───────────────────────────────

function resolveOwnership(
  ranges: RangeObject[],
  users: UserObject[],
): Record<string, string> {
  const ownership: Record<string, string> = {}
  const claimed = new Set<string>()

  // 1. Admin-confirmed assignments (SQLite) — highest priority
  for (const [rangeID, userID] of getAllOwnership()) {
    ownership[rangeID] = userID
    claimed.add(rangeID)
  }

  // 2. Ownership embedded in the range record itself
  for (const range of ranges) {
    if (claimed.has(range.rangeID)) continue
    const owner =
      range.userID ||
      (range as RangeObject & { ownerID?: string }).ownerID ||
      (range as RangeObject & { owner?: string }).owner
    if (owner) {
      ownership[range.rangeID] = owner
      claimed.add(range.rangeID)
    }
  }

  // 3. rangeID === userID (Ludus primary-range convention)
  const userIDs = new Set(users.map((u) => u.userID))
  for (const range of ranges) {
    if (claimed.has(range.rangeID)) continue
    if (userIDs.has(range.rangeID)) {
      ownership[range.rangeID] = range.rangeID
      claimed.add(range.rangeID)
    }
  }

  // 4. user.defaultRangeID / user.rangeID
  for (const user of users) {
    const defRange =
      (user as UserObject & { defaultRangeID?: string }).defaultRangeID ||
      (user as UserObject & { rangeID?: string }).rangeID
    if (defRange && !claimed.has(defRange)) {
      ownership[defRange] = user.userID
      claimed.add(defRange)
    }
  }

  return ownership
}

// ── Fast path: PocketBase + parallel Ludus range list for VM status ───────────
//
// PocketBase stores range metadata (numberOfVMs, rangeState, etc.) but does NOT
// store live Proxmox VM power state — that field is always empty in PB records.
// To show accurate "running / total" VM counts we fetch GET /range/all from the
// Ludus API in parallel (both requests fire simultaneously, so total latency is
// max(pb, ludus) rather than pb + ludus).  The VMs array from Ludus is merged
// into each PB range object; everything else (ownership, users) still comes from
// the fast PocketBase read.

async function buildAdminDataFromPb(apiKey: string): Promise<AdminData | null> {
  // Fire PocketBase and Ludus API calls in parallel
  const [pbData, ludusRangesRes] = await Promise.all([
    fetchPbAdminData(),
    ludusRequest<unknown>("/range/all", { apiKey }).catch(() => ({ data: null, error: "skipped" })),
  ])

  if (!pbData) return null

  const { ranges: pbRanges, users } = pbData

  // Build a rangeID → VMs map from the Ludus API response (if available)
  const ludusRanges: RangeObject[] = ludusRangesRes.data
    ? extractArray<RangeObject>(ludusRangesRes.data)
    : []
  const vmsByRangeId = new Map<string, VMObject[]>(
    ludusRanges.map((r) => [r.rangeID, dedupeVMs(r.VMs || [])])
  )

  // Merge live VM data into the PB range records
  const ranges = pbRanges.map((r) => ({
    ...r,
    VMs: mergeAdminRangeVms(r, vmsByRangeId.get(r.rangeID)),
  }))

  const ownership = resolveOwnership(ranges, users)
  return { ranges, users, ownership, ts: Date.now() }
}

// ── Slow path: Ludus API ──────────────────────────────────────────────────────

/** Cap detail lookups and run them with a small worker pool. */
const MAX_DETAIL_LOOKUPS = 30
const DETAIL_CONCURRENCY = 6

interface RangeOwnerDetail {
  rangeID: string
  owner?: string
  error?: string
}

async function buildAdminDataFromApi(apiKey: string): Promise<AdminData> {
  const [rangesRes, usersRes] = await Promise.all([
    ludusRequest<unknown>("/range/all", { apiKey }),
    ludusRequest<unknown>("/user/all", { apiKey }),
  ])

  let ranges: RangeObject[] = rangesRes.data
    ? extractArray<RangeObject>(rangesRes.data).map((r) => ({
        ...r,
        VMs: dedupeVMs(r.VMs || []),
      }))
    : []
  const users: UserObject[] = usersRes.data ? extractArray<UserObject>(usersRes.data) : []

  // Join the bulk payload locally first. Only ranges that are still unowned
  // after the SQLite, embedded-userID, primary-range, and default-range rules
  // need an individual detail request.
  const initialOwnership = resolveOwnership(ranges, users)
  const needsDetailAll = ranges.filter((r) => !initialOwnership[r.rangeID])
  const needsDetail = needsDetailAll.slice(0, MAX_DETAIL_LOOKUPS)
  const truncated = needsDetailAll.length > needsDetail.length
  const failedOrSkipped = new Set<string>(
    needsDetailAll.slice(MAX_DETAIL_LOOKUPS).map((r) => r.rangeID),
  )

  if (needsDetail.length > 0) {
    const details = await mapWithConcurrency(
      needsDetail,
      DETAIL_CONCURRENCY,
      async (r): Promise<RangeOwnerDetail> => {
        try {
          const res = await ludusRequest<RangeObject & { ownerID?: string; owner?: string }>(
            `/range?rangeID=${encodeURIComponent(r.rangeID)}`,
            { apiKey },
          )
          if (res.error) return { rangeID: r.rangeID, error: res.error }
          if (!res.data) return { rangeID: r.rangeID, error: "empty response" }
          const d = res.data
          return { rangeID: r.rangeID, owner: d.userID || d.ownerID || d.owner }
        } catch (err) {
          return {
            rangeID: r.rangeID,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      },
    )

    for (const detail of details) {
      if (detail.error) {
        failedOrSkipped.add(detail.rangeID)
        continue
      }
      if (!detail.owner) continue
      const idx = ranges.findIndex((r) => r.rangeID === detail.rangeID)
      if (idx !== -1) ranges[idx] = { ...ranges[idx], userID: detail.owner }
    }
  }

  const ownership = resolveOwnership(ranges, users)
  const unresolvedRangeIDs = [...failedOrSkipped]
    .filter((rangeID) => !ownership[rangeID])
    .sort()

  return {
    ranges,
    users,
    ownership,
    ts: Date.now(),
    ...(unresolvedRangeIDs.length > 0
      ? { partial: { unresolvedRangeIDs, truncated } }
      : {}),
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/** Ludus/PocketBase admin payload — used by `cachedAdminData` (`"use cache"`) and API routes. */
export async function buildAdminData(apiKey: string): Promise<AdminData> {
  // Fast path: PocketBase for ownership/users + parallel Ludus API for VM status.
  // Falls back automatically to the Ludus API if PocketBase is unavailable or
  // LUDUS_ROOT_API_KEY is not configured.
  const pbResult = await buildAdminDataFromPb(apiKey)
  if (pbResult) return pbResult

  console.log("[admin-data] PocketBase unavailable — using Ludus API (slow path)")
  return buildAdminDataFromApi(apiKey)
}

/**
 * Blocking-on-cold-start read (for API routes that must return a body).
 * Returns stale data immediately with background revalidation when cache is warm.
 */
export async function getAdminData(apiKey: string, options?: { bypassCache?: boolean }): Promise<AdminData> {
  const key = adminCacheKey(apiKey)
  if (options?.bypassCache) {
    _swrCache.invalidate(key)
  }
  return _swrCache.get(key, () => buildAdminData(apiKey))
}

/**
 * Non-blocking synchronous read (for SSR prefetch).
 * Returns whatever is in the cache right now (may be stale), or null.
 * Triggers a background revalidation when the cache is stale or empty.
 */
export function getAdminDataCached(apiKey: string): AdminData | null {
  return _swrCache.peek(`admin:${apiKey}`, () => buildAdminData(apiKey))
}
