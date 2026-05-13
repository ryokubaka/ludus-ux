import type { RangeOp } from "@/lib/range-op-store"
import { insertLuxTestingEvent } from "@/lib/range-log-markers-store"

/**
 * Persist a finished testing toggle for the Testing page activity list.
 * Ludus range log history does not emit deploy-history rows for testing snapshot/revert jobs,
 * so we do not correlate to Ludus log ids (would mis-label real deploys).
 */
export function recordLuxTestingOpTerminal(
  op: RangeOp,
  success: boolean,
  _ctx: { apiKey: string; userOverride?: string },
) {
  const completedAt = Date.now()
  try {
    insertLuxTestingEvent({
      rangeId: op.rangeId,
      username: op.username,
      opType: op.opType,
      rangeOpId: op.id,
      requestedAt: op.startedAt,
      completedAt,
      success,
    })
  } catch (err) {
    console.warn("[range-testing-audit] insert failed:", err)
  }
}
