import { ludusRequest } from "@/lib/ludus-client"
import type { LogHistoryEntry } from "@/lib/types"
import { extractArray } from "@/lib/utils"

const MATCH_BEFORE_MS = 25_000
const MATCH_AFTER_MS = 18 * 60_000

/**
 * Best-effort: find the Ludus deploy log history row that likely corresponds to
 * a LUX-initiated action that started around `requestedAtMs`.
 */
export async function correlateLudusLogIdAfterRangeAction(opts: {
  rangeId: string
  apiKey: string
  userOverride?: string
  requestedAtMs: number
}): Promise<string | null> {
  const res = await ludusRequest<unknown>(
    `/range/logs/history?rangeID=${encodeURIComponent(opts.rangeId)}`,
    { apiKey: opts.apiKey, userOverride: opts.userOverride, timeout: 25_000 },
  )
  if (res.error || res.data == null) return null
  const entries = extractArray<LogHistoryEntry>(res.data as unknown)
  const t0 = opts.requestedAtMs
  const sortedDesc = [...entries].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
  for (const e of sortedDesc) {
    const t = new Date(e.start).getTime()
    if (Number.isNaN(t)) continue
    if (t >= t0 - MATCH_BEFORE_MS && t <= t0 + MATCH_AFTER_MS) {
      return e.id
    }
  }
  return null
}
