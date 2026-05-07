/**
 * In-memory Ludus wall-clock sample — no Node-only deps.
 * Server routes call `noteLudusWallClockSample`; client code may read
 * `getCachedLudusWallHmsOrUtc` via log-line-timestamp (falls back to UTC).
 */

let sample: { hms: string; at: number } | null = null
const TTL_MS = 3800

/** Server-only: record SSH `date +%H:%M:%S` from Ludus host. */
export function noteLudusWallClockSample(hms: string): void {
  const h = hms.trim()
  if (/^\d{2}:\d{2}:\d{2}$/.test(h)) {
    sample = { hms: h, at: Date.now() }
  }
}

/** True if a sample exists and is younger than `maxAgeMs` (for SSH throttle). */
export function ludusWallClockSampleFresh(maxAgeMs: number): boolean {
  return sample != null && Date.now() - sample.at < maxAgeMs
}

/** Prefer Ludus sample when fresh; otherwise UTC (safe on client bundles). */
export function getCachedLudusWallHmsOrUtc(): string {
  if (sample && Date.now() - sample.at < TTL_MS + 500) return sample.hms
  return new Date().toISOString().slice(11, 19)
}
