/**
 * Shared GOAD ansible-log tail for `/api/logs/stream`.
 *
 * Several viewers can watch the same range at once. Each poll used to open its
 * own SSH `range-log read`; this cache coalesces concurrent reads and serves a
 * 2 s snapshot so the host sees at most one read per range per poll window.
 *
 * Failures are not cached: the next poll retries. The caller keeps its own
 * `lastCount` and slices the shared snapshot, so a new viewer still receives
 * the full backlog when `snapshotStart` is false.
 */

export type GoadLogTailResult =
  | { ok: true; lines: string[] }
  | { ok: false }

const TAIL_TTL_MS = 2000
const MAX_RANGES = 64
const ENTRY_MAX_AGE_MS = 60_000

interface TailEntry {
  ts: number
  lines: string[]
}

const entries = new Map<string, TailEntry>()
const inflight = new Map<string, Promise<string[]>>()

function prune(now: number): void {
  for (const [rangeId, entry] of entries) {
    if (now - entry.ts > ENTRY_MAX_AGE_MS) entries.delete(rangeId)
  }
  while (entries.size > MAX_RANGES) {
    const oldest = entries.keys().next()
    if (oldest.done) break
    entries.delete(oldest.value)
  }
}

export async function readGoadLogTail(
  rangeId: string,
  reader: () => Promise<string[]>,
): Promise<GoadLogTailResult> {
  const now = Date.now()
  const entry = entries.get(rangeId)
  if (entry && now - entry.ts < TAIL_TTL_MS) return { ok: true, lines: entry.lines }

  const pending = inflight.get(rangeId)
  if (pending) {
    try {
      return { ok: true, lines: await pending }
    } catch {
      return { ok: false }
    }
  }

  const work = reader()
    .then((lines) => {
      entries.set(rangeId, { ts: Date.now(), lines })
      prune(Date.now())
      return lines
    })
    .finally(() => {
      inflight.delete(rangeId)
    })
  inflight.set(rangeId, work)

  try {
    return { ok: true, lines: await work }
  } catch {
    return { ok: false }
  }
}

/** Drop cached tails (e.g. after a range is destroyed or re-deployed). */
export function invalidateGoadLogTail(rangeId?: string): void {
  if (rangeId !== undefined) entries.delete(rangeId)
  else entries.clear()
}
