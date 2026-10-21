/**
 * Browser helper: load clocks the server recorded while a deploy was running.
 */

import { stampDeployLogForDisplay, type DeployLogClockEntry } from "@/lib/log-line-timestamp"

export async function fetchDeployLogClock(rangeId: string): Promise<DeployLogClockEntry[][]> {
  const rid = rangeId.trim()
  if (!rid) return []
  try {
    const res = await fetch(`/api/logs/clock?rangeId=${encodeURIComponent(rid)}`, {
      credentials: "include",
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = (await res.json()) as { generations?: { entries?: DeployLogClockEntry[] }[] }
    if (!Array.isArray(data.generations)) return []
    return data.generations
      .map((generation) => (Array.isArray(generation.entries) ? generation.entries : []))
      .filter((entries) => entries.length > 0)
  } catch {
    return []
  }
}

/** Recorded clocks once they move. Otherwise the start/end, or start/now, spread. */
export async function stampHistoryWithRecordedClock(
  rangeId: string,
  raw: string[],
  startIso: string,
  endIso: string,
): Promise<string[]> {
  const generations = await fetchDeployLogClock(rangeId)
  return stampDeployLogForDisplay(raw, generations, startIso, endIso)
}
