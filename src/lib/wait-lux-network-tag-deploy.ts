import type { LogHistoryEntry } from "@/lib/types"
import { extractArray } from "@/lib/utils"
import { isNetworkOnlyTagDeploy } from "@/lib/goad-deploy-history-correlation"

export type LudusHistoryPoll = () => Promise<{
  data?: unknown
  error?: string
  status?: number
}>

export type NetworkTagDeployWaitResult =
  | { ok: true; via: "history"; entry: LogHistoryEntry }
  | { ok: true; via: "range_idle_after_inflight"; detail: string }
  | { ok: false; via: "history_failed" | "range_error" | "ceiling"; entry?: LogHistoryEntry; detail: string }

function isDeployHistoryRunning(status: string): boolean {
  const s = status.trim().toLowerCase()
  return s === "running" || s === "pending" || s === "waiting"
}

function isDeployHistoryTerminalFailure(status: string): boolean {
  const s = status.trim().toLowerCase()
  return (
    s === "error" ||
    s === "failed" ||
    s === "failure" ||
    s === "aborted" ||
    s === "cancelled" ||
    s === "canceled"
  )
}

/**
 * Ludus row for a tag deploy we just triggered: `network`-only, multi-tag with
 * `network`, or in-progress row with empty `template` (LUX absorb heuristic).
 */
function isCandidateNetworkFollowupRow(e: LogHistoryEntry, requestedAtMs: number): boolean {
  const ts = new Date(e.start).getTime()
  if (Number.isNaN(ts)) return false
  if (ts < requestedAtMs - 60_000) return false
  if (ts > requestedAtMs + 20 * 60_000) return false

  if (isNetworkOnlyTagDeploy(e)) return true

  const parts = (e.template || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (parts.includes("network")) return true

  const st = (e.status || "").trim().toLowerCase()
  if (st === "running" && parts.length === 0) {
    return ts >= requestedAtMs - 5_000 && ts <= requestedAtMs + 6 * 60_000
  }

  return false
}

/** Newest matching deploy history row for this follow-up (any status). */
export function pickNetworkFollowupDeployRow(
  entries: LogHistoryEntry[],
  requestedAtMs: number,
): LogHistoryEntry | null {
  const sorted = [...entries].sort(
    (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime(),
  )
  for (const e of sorted) {
    if (isCandidateNetworkFollowupRow(e, requestedAtMs)) return e
  }
  return null
}

/**
 * Wait until Ludus deploy **history** shows a terminal state for the `network`
 * follow-up we triggered around `requestedAtMs`, or until the range API shows
 * in-flight deploy then idle again (Ludus sometimes omits / delays history).
 *
 * `absoluteMaxMs` is only a deadlock guard (default 24h), not a "job must finish by" budget.
 */
export async function waitForNetworkTagDeployCompletion(opts: {
  rangeId: string
  requestedAtMs: number
  fetchHistory: LudusHistoryPoll
  fetchStatus: () => Promise<{ data?: { rangeState?: string }; error?: string }>
  pollMs?: number
  absoluteMaxMs?: number
}): Promise<NetworkTagDeployWaitResult> {
  const pollMs = opts.pollMs ?? 5_000
  const absoluteMaxMs = opts.absoluteMaxMs ?? 24 * 60 * 60 * 1000
  const start = Date.now()
  let sawRangeInFlight = false

  while (Date.now() - start < absoluteMaxMs) {
    const hist = await opts.fetchHistory()
    if (hist.error) {
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }
    const entries = extractArray<LogHistoryEntry>(hist.data as unknown)
    const row = pickNetworkFollowupDeployRow(entries, opts.requestedAtMs)

    const st = await opts.fetchStatus()
    const rs = String(st.data?.rangeState ?? "").trim().toUpperCase()
    if (rs === "DEPLOYING" || rs === "WAITING") sawRangeInFlight = true
    if (rs === "ERROR" || rs === "ABORTED") {
      return { ok: false, via: "range_error", detail: rs }
    }

    if (row) {
      const hs = row.status || ""
      if (isDeployHistoryTerminalFailure(hs)) {
        return { ok: false, via: "history_failed", entry: row, detail: hs }
      }
      if (!isDeployHistoryRunning(hs)) {
        return { ok: true, via: "history", entry: row }
      }
    } else if (sawRangeInFlight && rs && rs !== "DEPLOYING" && rs !== "WAITING") {
      return {
        ok: true,
        via: "range_idle_after_inflight",
        detail: `no matching deploy history row; rangeState=${rs}`,
      }
    }

    await new Promise((r) => setTimeout(r, pollMs))
  }

  return {
    ok: false,
    via: "ceiling",
    detail: `wait exceeded ${absoluteMaxMs}ms for range ${opts.rangeId}`,
  }
}
