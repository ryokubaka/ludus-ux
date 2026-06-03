/**
 * Simple in-memory sliding-window rate limiter (per-process).
 * Suitable for login throttling on single-instance deployments.
 */

interface WindowEntry {
  timestamps: number[]
}

const store = new Map<string, WindowEntry>()

const CLEANUP_INTERVAL_MS = 60_000
const timer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 60 * 60 * 1000)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}, CLEANUP_INTERVAL_MS)
if (typeof timer.unref === "function") timer.unref()

export interface RateLimitResult {
  allowed: boolean
  retryAfterSec?: number
}

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

  if (entry.timestamps.length >= maxAttempts) {
    const oldest = entry.timestamps[0] ?? now
    const retryAfterSec = Math.ceil((windowMs - (now - oldest)) / 1000)
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) }
  }

  entry.timestamps.push(now)
  return { allowed: true }
}

export function resetRateLimit(key?: string): void {
  if (key) store.delete(key)
  else store.clear()
}
