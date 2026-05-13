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
