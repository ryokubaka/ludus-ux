/**
 * In-process server-side cache with stale-while-revalidate (SWR) semantics.
 * Lives in Node.js process memory — survives across requests but resets on
 * container restart.
 *
 * Two access patterns:
 *
 *   peek(key, fetcher)
 *     Non-blocking.  Returns cached value (fresh or stale) immediately, or
 *     null when the cache is empty.  Triggers a background fetch/revalidate
 *     so the next call gets data.  Use this in SSR prefetch functions so they
 *     never block HTML delivery.
 *
 *   get(key, fetcher)
 *     Blocking only on cold start (no cache at all).  Returns stale data
 *     immediately (with background revalidation) when cache exists.  Use this
 *     in API route handlers that must return a response body.
 */

import { recordCacheAccess } from "@/lib/core/cache-metrics"

interface Entry<T> {
  data: T
  ts: number
}

export type TtlCacheResolveStatus = "hit" | "miss" | "stale" | "shared"

export interface TtlCacheResolveResult<T> {
  value: T
  status: TtlCacheResolveStatus
  /** Time spent in the fetcher (or waiting on a shared fetch); 0 on a hit. */
  fetchMs: number
}

/**
 * Bounded, short-TTL cache for correctness-sensitive reads (GOAD listings,
 * host patch state, admin discovery). Unlike `SWRCache`, an expired entry is
 * never served: `resolve` waits for a fresh read. Failures are not cached by
 * default, so the next request retries instead of showing stale-as-fresh data.
 *
 * Concurrent `resolve` calls for the same key share one in-flight fetch.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly inflight = new Map<string, Promise<{ value: T; stale: boolean }>>()
  private readonly ttl: number
  private readonly maxEntries: number

  constructor(ttlMs: number, maxEntries = 128) {
    this.ttl = ttlMs
    this.maxEntries = Math.max(1, maxEntries)
  }

  /**
   * Await a fresh value. Returns the cached value while it is within the TTL;
   * otherwise runs `fetcher` once (shared by concurrent callers).
   *
   * `cacheable` lets a caller keep a discriminated failure result out of the
   * cache. `staleOnError` returns the last entry when a refresh fails, which is
   * appropriate for read-only discovery where the previous answer is still the
   * best known one.
   */
  async resolve(
    key: string,
    fetcher: () => Promise<T>,
    opts?: { cacheable?: (value: T) => boolean; staleOnError?: boolean },
  ): Promise<T> {
    return (await this.resolveWithStatus(key, fetcher, opts)).value
  }

  /**
   * Same as `resolve`, plus the cache outcome and fetch duration. Routes use
   * this to emit an accurate `Server-Timing` cache phase.
   */
  async resolveWithStatus(
    key: string,
    fetcher: () => Promise<T>,
    opts?: { cacheable?: (value: T) => boolean; staleOnError?: boolean },
  ): Promise<TtlCacheResolveResult<T>> {
    const entry = this.entries.get(key)
    if (entry && Date.now() - entry.ts < this.ttl) {
      recordCacheAccess("ttl", "hit")
      return { value: entry.data, status: "hit", fetchMs: 0 }
    }

    const pending = this.inflight.get(key)
    if (pending) {
      recordCacheAccess("ttl", "shared")
      const start = performance.now()
      const outcome = await pending
      return { value: outcome.value, status: "shared", fetchMs: performance.now() - start }
    }

    const start = performance.now()
    const work = (async (): Promise<{ value: T; stale: boolean }> => {
      try {
        const data = await fetcher()
        if (!opts?.cacheable || opts.cacheable(data)) this.set(key, data)
        return { value: data, stale: false }
      } catch (err) {
        if (opts?.staleOnError && entry) return { value: entry.data, stale: true }
        throw err
      }
    })()
    this.inflight.set(key, work)
    try {
      const outcome = await work
      const status: TtlCacheResolveStatus = outcome.stale ? "stale" : "miss"
      recordCacheAccess("ttl", status)
      return { value: outcome.value, status, fetchMs: performance.now() - start }
    } finally {
      this.inflight.delete(key)
    }
  }

  /** Fresh cached value, or null when absent/expired. Does not start a fetch. */
  get(key: string): T | null {
    const entry = this.entries.get(key)
    if (!entry) {
      recordCacheAccess("ttl", "miss")
      return null
    }
    if (Date.now() - entry.ts >= this.ttl) {
      this.entries.delete(key)
      recordCacheAccess("ttl", "stale")
      return null
    }
    recordCacheAccess("ttl", "hit")
    return entry.data
  }

  set(key: string, data: T): void {
    this.entries.delete(key)
    this.entries.set(key, { data, ts: Date.now() })
    this.evict()
  }

  invalidate(key?: string): void {
    if (key !== undefined) this.entries.delete(key)
    else this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  /** Drop the oldest entries when the bound is exceeded (Map preserves insertion order). */
  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }
}

/**
 * Cache keys here include scope and range IDs, so an unbounded map grows with
 * every user/range an admin impersonates or opens. Keep a hard entry bound and
 * periodically drop entries far past their TTL (stale entries stay useful for
 * one revalidation window, so they are not swept immediately).
 */
const DEFAULT_MAX_ENTRIES = 256
const MIN_STALE_RETENTION_MS = 5 * 60_000
const SWEEP_INTERVAL_MS = 60_000

export class SWRCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly inflight = new Set<string>()
  private readonly ttl: number
  private readonly maxEntries: number
  private readonly staleRetentionMs: number
  private lastSweepAt = 0

  constructor(ttlMs: number, opts?: { maxEntries?: number }) {
    this.ttl = ttlMs
    this.maxEntries = Math.max(1, opts?.maxEntries ?? DEFAULT_MAX_ENTRIES)
    this.staleRetentionMs = Math.max(ttlMs * 8, MIN_STALE_RETENTION_MS)
  }

  /**
   * Non-blocking read.
   *   - Fresh cache  → return data immediately
   *   - Stale cache  → return data immediately + background revalidate
   *   - No cache     → start background fetch, return null
   */
  peek(key: string, fetcher: () => Promise<T>): T | null {
    const entry = this.entries.get(key)

    if (!entry) {
      recordCacheAccess("swr", "miss")
      this.revalidate(key, fetcher)
      return null
    }

    this.touch(key, entry)
    const now = Date.now()
    this.sweepIfDue(now)
    if (now - entry.ts >= this.ttl) {
      recordCacheAccess("swr", "stale")
      this.revalidate(key, fetcher)
    } else {
      recordCacheAccess("swr", "hit")
    }

    return entry.data
  }

  /**
   * Blocking-on-cold-start read.
   *   - Fresh cache  → return data immediately
   *   - Stale cache  → return data immediately + background revalidate
   *   - No cache     → await fetcher (only blocks on the very first request)
   */
  async get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key)

    if (entry) {
      this.touch(key, entry)
      const now = Date.now()
      this.sweepIfDue(now)
      if (now - entry.ts >= this.ttl) {
        recordCacheAccess("swr", "stale")
        this.revalidate(key, fetcher)
      } else {
        recordCacheAccess("swr", "hit")
      }
      return entry.data
    }

    // Cold start: must fetch and wait
    recordCacheAccess("swr", "miss")
    const data = await fetcher()
    this.set(key, data)
    this.inflight.delete(key)
    return data
  }

  invalidate(key?: string): void {
    if (key !== undefined) {
      this.entries.delete(key)
    } else {
      this.entries.clear()
    }
  }

  get size(): number {
    return this.entries.size
  }

  /** Whether a key is currently held (fresh or stale). Does not start a fetch. */
  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** Insert/update an entry and enforce the bound. Map order is least-recently-used first. */
  private set(key: string, data: T): void {
    this.entries.delete(key)
    this.entries.set(key, { data, ts: Date.now() })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    this.sweepIfDue(Date.now())
  }

  /** Move a read entry to the most-recently-used end. */
  private touch(key: string, entry: Entry<T>): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
  }

  /** Drop entries that have been stale for several TTLs; runs at most once a minute. */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return
    this.lastSweepAt = now
    for (const [key, entry] of this.entries) {
      if (now - entry.ts > this.staleRetentionMs) this.entries.delete(key)
    }
  }

  private revalidate(key: string, fetcher: () => Promise<T>): void {
    if (this.inflight.has(key)) return
    this.inflight.add(key)
    fetcher()
      .then((data) => this.set(key, data))
      .catch(() => { /* leave stale entry in place */ })
      .finally(() => this.inflight.delete(key))
  }
}
