/**
 * `Server-Timing` support for LUX routes.
 *
 * Enabled by default so the perf harness can attribute latency to auth,
 * preflight, and upstream phases. Set `LUX_SERVER_TIMING=0` to disable it.
 * Metric names are fixed tokens; values are rounded milliseconds.
 */

export type ServerTimingPhase = number | { dur: number; desc?: string }

export function serverTimingHeader(phases: Record<string, ServerTimingPhase>): string | null {
  if (process.env.LUX_SERVER_TIMING === "0") return null
  const parts: string[] = []
  for (const [name, value] of Object.entries(phases)) {
    const duration = typeof value === "number" ? value : value.dur
    if (!Number.isFinite(duration) || duration < 0) continue
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) continue
    let part = `${name};dur=${Math.round(duration)}`
    if (typeof value === "object" && value.desc && /^[A-Za-z0-9_.-]+$/.test(value.desc)) {
      part += `;desc=${value.desc}`
    }
    parts.push(part)
  }
  return parts.length > 0 ? parts.join(", ") : null
}
