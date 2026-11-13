import { beforeEach, describe, expect, it } from "vitest"
import {
  getCacheMetrics,
  recordCacheAccess,
  resetCacheMetrics,
} from "@/lib/core/cache-metrics"

describe("cache metrics", () => {
  beforeEach(() => {
    resetCacheMetrics()
  })

  it("counts outcomes globally and by cache", () => {
    recordCacheAccess("ttl", "hit")
    recordCacheAccess("ttl", "miss")
    recordCacheAccess("swr", "stale")
    recordCacheAccess("swr", "shared")

    const metrics = getCacheMetrics()
    expect(metrics.totals).toEqual({ hit: 1, miss: 1, stale: 1, shared: 1 })
    expect(metrics.caches.ttl).toEqual({ hit: 1, miss: 1, stale: 0, shared: 0 })
    expect(metrics.caches.swr).toEqual({ hit: 0, miss: 0, stale: 1, shared: 1 })
  })

  it("returns a snapshot that cannot mutate the counters", () => {
    recordCacheAccess("ttl", "hit")
    const snapshot = getCacheMetrics()
    snapshot.totals.hit = 99
    snapshot.caches.ttl!.hit = 99
    expect(getCacheMetrics().totals.hit).toBe(1)
    expect(getCacheMetrics().caches.ttl!.hit).toBe(1)
  })
})
