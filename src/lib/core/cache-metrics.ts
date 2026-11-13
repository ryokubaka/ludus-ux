/**
 * Process-level cache telemetry.
 *
 * Counters are intentionally cheap (no timestamps, no keys) so every cache
 * read can record an outcome without affecting the request path. They reset
 * on process restart, which is the right lifetime for an in-process cache.
 */

export type CacheOutcome = "hit" | "miss" | "stale" | "shared"

export interface CacheOutcomeCounts {
  hit: number
  miss: number
  stale: number
  shared: number
}

export interface CacheMetricsSnapshot {
  totals: CacheOutcomeCounts
  caches: Record<string, CacheOutcomeCounts>
}

function emptyCounts(): CacheOutcomeCounts {
  return { hit: 0, miss: 0, stale: 0, shared: 0 }
}

const totals = emptyCounts()
const byCache = new Map<string, CacheOutcomeCounts>()

/** Record one cache lookup outcome. Cache names are fixed internal labels. */
export function recordCacheAccess(cache: string, outcome: CacheOutcome): void {
  totals[outcome] += 1
  let entry = byCache.get(cache)
  if (!entry) {
    entry = emptyCounts()
    byCache.set(cache, entry)
  }
  entry[outcome] += 1
}

export function getCacheMetrics(): CacheMetricsSnapshot {
  const caches: Record<string, CacheOutcomeCounts> = {}
  for (const [name, counts] of byCache) {
    caches[name] = { ...counts }
  }
  return { totals: { ...totals }, caches }
}

/** Test helper; also useful for a manual counter reset from an admin tool. */
export function resetCacheMetrics(): void {
  totals.hit = 0
  totals.miss = 0
  totals.stale = 0
  totals.shared = 0
  byCache.clear()
}
