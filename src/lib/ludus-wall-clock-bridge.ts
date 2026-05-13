/**
 * In-memory clock sample for deploy / GOAD log line prefixes.
 * Server: SSH `date +%s` on Ludus host → format in `process.env.TZ` (default America/New_York).
 * Client: same formatter with `Date.now()` when no sample (no SSH in bundle).
 */

let sample: { epochMs: number; at: number } | null = null
const TTL_MS = 3800

function resolveLogTimeZone(): string {
  const z = typeof process !== "undefined" ? process.env.TZ?.trim() : ""
  return z && z.length > 0 ? z : "America/New_York"
}

/** `YYYY-MM-DDTHH:mm:ss` + short zone label (e.g. EDT) in `TZ`. */
export function formatInstantForDeployLog(ms: number): string {
  const timeZone = resolveLogTimeZone()
  const d = new Date(ms)
  const core = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d)
  const isoLike = core.includes(" ") ? core.replace(" ", "T") : core
  const tzPart =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value?.trim() ?? ""
  return tzPart ? `${isoLike} ${tzPart}` : isoLike
}

/** Server-only: record POSIX seconds from Ludus/Proxmox host (`date +%s`). */
export function noteLudusWallClockEpoch(stdout: string): void {
  const sec = parseInt(stdout.trim(), 10)
  if (!Number.isFinite(sec) || sec < 1_000_000_000 || sec > 9_999_999_999) return
  sample = { epochMs: sec * 1000, at: Date.now() }
}

/** True if a sample exists and is younger than `maxAgeMs` (for SSH throttle). */
export function ludusWallClockSampleFresh(maxAgeMs: number): boolean {
  return sample != null && Date.now() - sample.at < maxAgeMs
}

/** Prefer Ludus-host instant when fresh; else this process clock — both in `TZ`. */
export function getCachedLudusWallHmsOrUtc(): string {
  const now = Date.now()
  const ms = sample && now - sample.at < TTL_MS + 500 ? sample.epochMs : now
  return formatInstantForDeployLog(ms)
}
