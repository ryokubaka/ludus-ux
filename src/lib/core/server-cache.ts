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

interface Entry<T> {
  data: T
  ts: number
}

export class SWRCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly inflight = new Set<string>()
  private readonly ttl: number

  constructor(ttlMs: number) {
    this.ttl = ttlMs
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
      this.revalidate(key, fetcher)
      return null
    }

    if (Date.now() - entry.ts >= this.ttl) {
      this.revalidate(key, fetcher)
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
      if (Date.now() - entry.ts >= this.ttl) {
        this.revalidate(key, fetcher)
      }
      return entry.data
    }

    // Cold start: must fetch and wait
    const data = await fetcher()
    this.entries.set(key, { data, ts: Date.now() })
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

  private revalidate(key: string, fetcher: () => Promise<T>): void {
    if (this.inflight.has(key)) return
    this.inflight.add(key)
    fetcher()
      .then((data) => this.entries.set(key, { data, ts: Date.now() }))
      .catch(() => { /* leave stale entry in place */ })
      .finally(() => this.inflight.delete(key))
  }
}
