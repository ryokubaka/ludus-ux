import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SWRCache, TtlCache } from "@/lib/core/server-cache"
import { resetCacheMetrics } from "@/lib/core/cache-metrics"

describe("TtlCache", () => {
  beforeEach(() => {
    resetCacheMetrics()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("serves a fresh value without calling the fetcher", async () => {
    const cache = new TtlCache<number>(1000)
    cache.set("k", 1)
    const fetcher = vi.fn(async () => 2)
    await expect(cache.resolve("k", fetcher)).resolves.toBe(1)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("refetches after the TTL expires", async () => {
    const cache = new TtlCache<number>(1000)
    cache.set("k", 1)
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"))
    const fetcher = vi.fn(async () => 2)
    await expect(cache.resolve("k", fetcher)).resolves.toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("shares one in-flight fetch between concurrent callers", async () => {
    const cache = new TtlCache<number>(1000)
    let release!: (value: number) => void
    const fetcher = vi.fn(() => new Promise<number>((resolve) => { release = resolve }))
    const first = cache.resolve("k", fetcher)
    const second = cache.resolve("k", fetcher)
    release(7)
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("does not cache a non-cacheable result", async () => {
    const cache = new TtlCache<{ ok: boolean }>(1000)
    const fetcher = vi.fn(async () => ({ ok: false }))
    await cache.resolve("k", fetcher, { cacheable: (v) => v.ok })
    await cache.resolve("k", fetcher, { cacheable: (v) => v.ok })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("does not cache a rejected fetch", async () => {
    const cache = new TtlCache<number>(1000)
    const fetcher = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(3)
    await expect(cache.resolve("k", fetcher)).rejects.toThrow("offline")
    await expect(cache.resolve("k", fetcher)).resolves.toBe(3)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("can return the last value when a refresh fails", async () => {
    const cache = new TtlCache<number>(1000)
    cache.set("k", 5)
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"))
    await expect(
      cache.resolve("k", async () => { throw new Error("offline") }, { staleOnError: true }),
    ).resolves.toBe(5)
  })

  it("reports hit, miss, and stale outcomes for route timing", async () => {
    const cache = new TtlCache<number>(1000)
    cache.set("k", 1)

    const hit = await cache.resolveWithStatus("k", async () => 2)
    expect(hit).toMatchObject({ value: 1, status: "hit", fetchMs: 0 })

    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"))
    const miss = await cache.resolveWithStatus("k", async () => 2)
    expect(miss.status).toBe("miss")
    expect(miss.value).toBe(2)

    vi.setSystemTime(new Date("2026-01-01T00:00:04Z"))
    const stale = await cache.resolveWithStatus(
      "k",
      async () => { throw new Error("offline") },
      { staleOnError: true },
    )
    expect(stale).toMatchObject({ value: 2, status: "stale" })
  })

  it("reports a shared outcome when a caller joins an in-flight fetch", async () => {
    const cache = new TtlCache<number>(1000)
    let release!: (value: number) => void
    const fetcher = vi.fn(() => new Promise<number>((resolve) => { release = resolve }))
    const first = cache.resolveWithStatus("k", fetcher)
    const second = cache.resolveWithStatus("k", fetcher)
    release(7)
    const [a, b] = await Promise.all([first, second])
    expect(a.status).toBe("miss")
    expect(b.status).toBe("shared")
    expect(b.value).toBe(7)
  })

  it("evicts the oldest entry when the bound is exceeded", async () => {
    const cache = new TtlCache<number>(60_000, 2)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    expect(cache.size).toBe(2)
    expect(cache.get("a")).toBeNull()
    expect(cache.get("b")).toBe(2)
    expect(cache.get("c")).toBe(3)
  })
})

describe("SWRCache", () => {
  beforeEach(() => {
    resetCacheMetrics()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("bounds entries and evicts the least-recently-used key", async () => {
    const cache = new SWRCache<number>(60_000, { maxEntries: 2 })
    await cache.get("a", async () => 1)
    await cache.get("b", async () => 2)
    await cache.get("c", async () => 3)
    expect(cache.size).toBe(2)
    // `a` was the oldest write and is gone.
    expect(cache.has("a")).toBe(false)

    // Reading `b` makes it the most recently used, so inserting `d` drops `c`.
    await cache.get("b", async () => 99)
    await cache.get("d", async () => 4)
    expect(cache.size).toBe(2)
    expect(cache.has("b")).toBe(true)
    expect(cache.has("c")).toBe(false)
    await expect(cache.get("b", async () => 99)).resolves.toBe(2)
    await expect(cache.get("d", async () => 44)).resolves.toBe(4)
  })

  it("sweeps entries that stayed stale far past the TTL", async () => {
    const cache = new SWRCache<number>(1_000, { maxEntries: 8 })
    await cache.get("old", async () => 1)
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"))
    await cache.get("fresh", async () => 2)
    expect(cache.size).toBe(1)
    expect(cache.peek("old", async () => 1)).toBeNull()
  })

  it("keeps stale entries inside the revalidation window", async () => {
    const cache = new SWRCache<number>(1_000, { maxEntries: 8 })
    await cache.get("a", async () => 1)
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"))
    // Two seconds old: stale but still served while the background refresh runs.
    expect(cache.peek("a", async () => 2)).toBe(1)
    expect(cache.size).toBe(1)
  })

  it("never exceeds the default bound", async () => {
    const cache = new SWRCache<number>(60_000)
    for (let i = 0; i < 400; i++) {
      await cache.get(`k${i}`, async () => i)
    }
    expect(cache.size).toBeLessThanOrEqual(256)
  })
})
