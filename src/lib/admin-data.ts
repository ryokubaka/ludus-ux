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
 *   for ownership resolution.  Can take 5–10 s with many ranges.
 *
 * Ownership resolution priority (highest → lowest):
 *   1. SQLite range_ownership table  (admin-confirmed, survives restarts)
 *   2. range.userID from PocketBase (or GET /range/all)
 *   3. range.rangeID === user.userID  (Ludus primary-range convention)
 *   4. user.defaultRangeID / user.rangeID
 *   5. Individual GET /range?rangeID=X  (slow path only; PB path skips this)
 */

import { ludusRequest } from "@/lib/ludus-client"
import { getAllOwnership } from "@/lib/range-ownership-store"
import { fetchPbAdminData } from "@/lib/pocketbase-client"
import type { RangeObject, UserObject } from "@/lib/types"

export interface AdminData {
  ranges: RangeObject[]
  users: UserObject[]
  ownership: Record<string, string>
  ts: number
}

import { SWRCache } from "@/lib/server-cache"

const _swrCache = new SWRCache<AdminData>(30_000)

export function bustAdminCache(): void {
  _swrCache.invalidate()
}

export function extractArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === "object" && "result" in data) {
    const r = (data as { result: unknown }).result
    if (Array.isArray(r)) return r as T[]
  }
  return []
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

// ── Fast path: PocketBase ─────────────────────────────────────────────────────

async function buildAdminDataFromPb(): Promise<AdminData | null> {
  const pbData = await fetchPbAdminData()
  if (!pbData) return null

  const { ranges, users } = pbData
  const ownership = resolveOwnership(ranges, users)

  return { ranges, users, ownership, ts: Date.now() }
}

// ── Slow path: Ludus API ──────────────────────────────────────────────────────

async function buildAdminDataFromApi(apiKey: string): Promise<AdminData> {
  const [rangesRes, usersRes] = await Promise.all([
    ludusRequest<unknown>("/range/all", { apiKey }),
    ludusRequest<unknown>("/user/all", { apiKey }),
  ])

  let ranges: RangeObject[] = rangesRes.data ? extractArray<RangeObject>(rangesRes.data) : []
  const users: UserObject[] = usersRes.data ? extractArray<UserObject>(usersRes.data) : []

  // For ranges still missing an owner, fetch individual range details (up to 30)
  const storedOwnership = getAllOwnership()
  const needsDetail = ranges
    .filter((r) => !r.userID && !storedOwnership.has(r.rangeID))
    .slice(0, 30)

  if (needsDetail.length > 0) {
    const details = await Promise.allSettled(
      needsDetail.map((r) =>
        ludusRequest<RangeObject & { ownerID?: string; owner?: string }>(
          `/range?rangeID=${encodeURIComponent(r.rangeID)}`,
          { apiKey },
        ),
      ),
    )
    for (let i = 0; i < needsDetail.length; i++) {
      const result = details[i]
      if (result.status === "fulfilled" && result.value.data) {
        const d = result.value.data
        const owner = d.userID || d.ownerID || d.owner
        if (owner) {
          const idx = ranges.findIndex((r) => r.rangeID === needsDetail[i].rangeID)
          if (idx !== -1) ranges[idx] = { ...ranges[idx], userID: owner }
        }
      }
    }
  }

  const ownership = resolveOwnership(ranges, users)
  return { ranges, users, ownership, ts: Date.now() }
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function buildAdminData(apiKey: string): Promise<AdminData> {
  // Fast path: query PocketBase directly (2 parallel DB reads, ~50–200 ms).
  // Falls back automatically to the Ludus API if PocketBase is unavailable or
  // LUDUS_ROOT_API_KEY is not configured.
  const pbResult = await buildAdminDataFromPb()
  if (pbResult) return pbResult

  console.log("[admin-data] PocketBase unavailable — using Ludus API (slow path)")
  return buildAdminDataFromApi(apiKey)
}

/**
 * Blocking-on-cold-start read (for API routes that must return a body).
 * Returns stale data immediately with background revalidation when cache is warm.
 */
export async function getAdminData(apiKey: string): Promise<AdminData> {
  return _swrCache.get("admin", () => buildAdminData(apiKey))
}

/**
 * Non-blocking synchronous read (for SSR prefetch).
 * Returns whatever is in the cache right now (may be stale), or null.
 * Triggers a background revalidation when the cache is stale or empty.
 */
export function getAdminDataCached(apiKey: string): AdminData | null {
  return _swrCache.peek("admin", () => buildAdminData(apiKey))
}
