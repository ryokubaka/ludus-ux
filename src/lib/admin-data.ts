/**
 * Shared admin data fetcher used by both:
 *   - /api/admin/ranges-data  (the API route)
 *   - app/admin/page.tsx      (server-side SSR prefetch)
 *
 * The 30-second in-process cache is shared across both callers so there is
 * never redundant work when the server component and the API route both run
 * close together on page load.
 */

import { ludusRequest } from "@/lib/ludus-client"
import { getAllOwnership } from "@/lib/range-ownership-store"
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

async function buildAdminData(apiKey: string): Promise<AdminData> {
  const [rangesRes, usersRes] = await Promise.all([
    ludusRequest<unknown>("/range/all", { apiKey }),
    ludusRequest<unknown>("/user/all", { apiKey }),
  ])

  let ranges: RangeObject[] = rangesRes.data ? extractArray<RangeObject>(rangesRes.data) : []
  const users: UserObject[] = usersRes.data ? extractArray<UserObject>(usersRes.data) : []

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

  const ownership: Record<string, string> = {}
  const claimed = new Set<string>()

  for (const [rangeID, userID] of storedOwnership) {
    ownership[rangeID] = userID
    claimed.add(rangeID)
  }

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

  const userIDs = new Set(users.map((u) => u.userID))
  for (const range of ranges) {
    if (claimed.has(range.rangeID)) continue
    if (userIDs.has(range.rangeID)) {
      ownership[range.rangeID] = range.rangeID
      claimed.add(range.rangeID)
    }
  }

  for (const user of users) {
    const defRange = (user as UserObject & { defaultRangeID?: string; rangeID?: string }).defaultRangeID
      || (user as UserObject & { rangeID?: string }).rangeID
    if (defRange && !claimed.has(defRange)) {
      ownership[defRange] = user.userID
      claimed.add(defRange)
    }
  }

  return { ranges, users, ownership, ts: Date.now() }
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
