import type { LogHistoryEntry } from "./types"
import { extractArray } from "./utils"

function deployHistoryStatusInFlight(status: string): boolean {
  const s = status.trim().toLowerCase()
  return s === "running" || s === "pending" || s === "waiting"
}

/**
 * Latest `start` time (ms) among Ludus deploy history rows that are still in-flight.
 * Used to anchor "Deploy Logs" elapsed time across page refresh.
 */
/**
 * History row the live range-log pane should show.
 * An in-flight deploy wins. Otherwise the newest start time wins, whatever
 * order Ludus returned the list in. `entries[0]` is often an older run.
 */
export function pickLatestDeployHistoryEntry(entries: LogHistoryEntry[]): LogHistoryEntry | undefined {
  let best: LogHistoryEntry | undefined
  let bestInFlight = false
  let bestStart = -Infinity
  for (const entry of entries) {
    const start = new Date(entry.start).getTime()
    const t = Number.isFinite(start) ? start : -Infinity
    const inFlight = deployHistoryStatusInFlight(entry.status)
    if (!best || (inFlight && !bestInFlight) || (inFlight === bestInFlight && t >= bestStart)) {
      best = entry
      bestInFlight = inFlight
      bestStart = t
    }
  }
  return best
}

export function pickInFlightDeployStartedMs(entries: LogHistoryEntry[]): number | null {
  let best: number | null = null
  for (const e of entries) {
    if (!deployHistoryStatusInFlight(e.status)) continue
    const t = new Date(e.start).getTime()
    if (!Number.isFinite(t)) continue
    if (best == null || t > best) best = t
  }
  return best
}

export async function fetchDeployElapsedAnchorMs(
  fetchHistory: (rangeId: string) => Promise<{ data?: unknown; error?: string }>,
  rangeId: string,
): Promise<number | null> {
  const rid = rangeId.trim()
  if (!rid) return null
  try {
    const res = await fetchHistory(rid)
    if (res.error) return null
    const entries = extractArray<LogHistoryEntry>(res.data as unknown)
    return pickInFlightDeployStartedMs(entries)
  } catch {
    return null
  }
}
