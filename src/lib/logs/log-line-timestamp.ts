/**
 * Wall-clock timestamps for streamed / persisted log lines (GOAD task store,
 * Ludus deploy SSE, history replay).
 *
 * Live paths prefer the Ludus host instant when a server route has pushed a sample
 * into `ludus-wall-clock-bridge.ts`; otherwise this process clock. Display uses
 * `process.env.TZ` when set, else `America/New_York` (matches docker-compose default).
 */

import {
  getCachedLudusWallHmsOrUtc,
  formatInstantForDeployLog,
} from "@/lib/ludus/ludus-wall-clock-bridge"

function bracketedWallTimestampInner(trimmed: string): string | null {
  const m = trimmed.match(/^\[([^\]]+)\]/)
  return m ? m[1] : null
}

function looksLikeBracketedWallTimestamp(trimmed: string): boolean {
  const inner = bracketedWallTimestampInner(trimmed)
  if (!inner) return false
  if (/^\d{2}:\d{2}:\d{2}$/.test(inner)) return true
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/.test(inner)
}

/** Ludus-host instant when SSH sample is warm; else this process — formatted in `TZ`. */
export function formatStreamWallHms(): string {
  return getCachedLudusWallHmsOrUtc()
}

/** GOAD control / meta lines — never prefix with a wall timestamp. */
function isGoadControlLine(line: string): boolean {
  const t = line.trimStart()
  return (
    t.startsWith("[EXIT]") ||
    t.startsWith("[ERROR]") ||
    t.startsWith("[TASKID]")
  )
}

/** Prefix one GOAD/ansible output line when persisting or streaming (idempotent). */
export function prefixGoadTaskLogLineWithTimestamp(line: string): string {
  if (isGoadControlLine(line)) return line
  const t = line.trimStart()
  if (looksLikeBracketedWallTimestamp(t)) return line
  return `[${formatStreamWallHms()}] ${line}`
}

function lineLooksTimestamped(line: string): boolean {
  const t = line.trimStart()
  if (looksLikeBracketedWallTimestamp(t)) return true
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return true
  if (/^\d{4}\/\d{2}\/\d{2}/.test(t)) return true
  return false
}

/** True when a Ludus/GOAD log line already carries a usable wall timestamp (do not inject poll time). */
export function deployLogLineHasLeadingWallTimestamp(line: string): boolean {
  return lineLooksTimestamped(line)
}

/**
 * Ansible prints a blank line between tasks. The live stream used to stamp
 * those with the poll clock, and the GOAD ansible log re-sent every one of
 * them because empty lines are not deduped. A line is blank when nothing
 * remains after the role prefix and wall-clock stamp.
 */
export function isBlankDeployLogLine(line: string): boolean {
  const withoutRole = line.replace(/^\[(?:LUDUS|GOAD|ERROR)\]\s*/, "")
  const { body } = splitLeadingWallTimestamp(withoutRole)
  return body.trim().length === 0
}

export function omitBlankLogLines(lines: string[]): string[] {
  return lines.filter((line) => !isBlankDeployLogLine(line))
}

/**
 * Split `[HH:MM:SS]` or `[YYYY-MM-DDTHH:mm:ss…]` wall prefix from the rest of the line.
 */
export function splitLeadingWallTimestamp(line: string): { ts: string | null; body: string } {
  const m = line.match(/^\[([^\]]+)\]\s([\s\S]*)$/)
  if (!m) return { ts: null, body: line }
  const inner = m[1]
  const rest = m[2]
  if (
    /^\d{2}:\d{2}:\d{2}$/.test(inner) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/.test(inner)
  ) {
    return { ts: inner, body: rest }
  }
  return { ts: null, body: line }
}

/**
 * Ludus GET /range/logs/history/{id} returns plain `result` text — no per-line
 * timestamps like the live SSE panel. Interpolate between `start` and `end`
 * using the same second-level `TZ` format as live logs (`formatInstantForDeployLog`).
 * A finished run is spread between its real start and end. A still-running run
 * has no end, so it spreads from `start` to now. That is the stand-in when no
 * per-line time was recorded. A one-second step per line is not wall time.
 */
const HISTORY_INTERPOLATE_MAX_SPAN_MS = 6 * 60 * 60 * 1000

/** Stable short hash of one log body. Same result in the browser and on the server. */
export function hashDeployLogLine(body: string): string {
  let h = 5381
  for (let i = 0; i < body.length; i++) h = Math.imul(h, 33) ^ body.charCodeAt(i)
  return (h >>> 0).toString(16).padStart(8, "0")
}

export type DeployLogClockEntry = { h: string; ms: number }

/** Leading raw lines whose hash matches `entries`, in order. */
export function deployLogClockPrefix(rawLines: string[], entries: DeployLogClockEntry[]): number {
  const n = Math.min(rawLines.length, entries.length)
  let i = 0
  while (i < n && hashDeployLogLine(rawLines[i] ?? "") === entries[i]?.h) i++
  return i
}

/**
 * Clock whose hashes are a prefix of this text (or this text is a prefix of the clock).
 * A generation that diverges in the middle is an older deploy.
 */
export function selectDeployLogClock(
  rawLines: string[],
  generations: DeployLogClockEntry[][],
): DeployLogClockEntry[] | null {
  let best: DeployLogClockEntry[] | null = null
  let bestN = 0
  for (const entries of generations) {
    if (entries.length === 0) continue
    const n = deployLogClockPrefix(rawLines, entries)
    if (n < entries.length && n < rawLines.length) continue
    if (n > bestN) {
      best = entries
      bestN = n
    }
  }
  return best
}

/** Prefix lines get their recorded clock. Lines the recorder has not seen yet stay plain. */
export function stampLinesWithClock(rawLines: string[], entries: DeployLogClockEntry[] | null): string[] {
  if (!entries) return rawLines
  const n = deployLogClockPrefix(rawLines, entries)
  if (n === 0) return rawLines
  if (n < entries.length && n < rawLines.length) return rawLines
  return rawLines.map((line, i) => {
    if (i >= n) return line
    if (deployLogLineHasLeadingWallTimestamp(line)) return line
    const ms = entries[i]?.ms
    // ms 0 is the baseline the recorder writes the first time it sees a file.
    // Those lines were already there; they do not share one real timestamp.
    if (ms == null || ms <= 0) return line
    return `[${formatInstantForDeployLog(ms)}] ${line}`
  })
}

/**
 * Append hashes for lines new since `entries`. `fresh` means this text is not
 * an append (new deploy); the caller stores it as its own generation.
 */
export function extendDeployLogClock(
  entries: DeployLogClockEntry[],
  rawLines: string[],
  observedAtMs: number,
): { entries: DeployLogClockEntry[]; fresh: boolean } {
  const n = entries.length === 0 ? 0 : deployLogClockPrefix(rawLines, entries)
  if (entries.length > 0 && n < entries.length) {
    return {
      fresh: true,
      entries: rawLines.map((line) => ({ h: hashDeployLogLine(line), ms: observedAtMs })),
    }
  }
  if (n >= rawLines.length) return { entries, fresh: false }
  const next = entries.slice()
  // The first sight of a file is a backlog, not a moment. Only lines that show
  // up on a later read get `observedAtMs`.
  const ms = entries.length === 0 ? 0 : observedAtMs
  for (let i = entries.length; i < rawLines.length; i++) {
    next.push({ h: hashDeployLogLine(rawLines[i] ?? ""), ms })
  }
  return { entries: next, fresh: false }
}

/** True when the matched prefix has more than one real recorded time. */
export function deployLogClockHasVariedTimes(entries: DeployLogClockEntry[], count: number): boolean {
  let first = 0
  let saw = false
  const n = Math.min(count, entries.length)
  for (let i = 0; i < n; i++) {
    const ms = entries[i]?.ms ?? 0
    if (ms <= 0) continue
    if (!saw) {
      first = ms
      saw = true
      continue
    }
    if (ms !== first) return true
  }
  return false
}

/**
 * Index of the first recorded time that is not the opening stamp.
 * Lines before that were already in the file when recording started, so they
 * share one clock and the start/now spread is the better display.
 */
function firstChangedClockIndex(entries: DeployLogClockEntry[], count: number): number {
  const n = Math.min(count, entries.length)
  let first = 0
  let saw = false
  for (let i = 0; i < n; i++) {
    const ms = entries[i]?.ms ?? 0
    if (ms <= 0) continue
    if (!saw) {
      first = ms
      saw = true
      continue
    }
    if (ms !== first) return i
  }
  return n
}

/**
 * Recorded times win once the clock actually moves.
 * Lines before that, and lines the recorder has not seen, keep the start/end
 * (or start/now) spread.
 */
export function stampDeployLogForDisplay(
  rawLines: string[],
  generations: DeployLogClockEntry[][],
  startIso: string,
  endIso: string,
  nowMs: number = Date.now(),
): string[] {
  const spanned = augmentLudusDeployHistoryLines(rawLines, startIso, endIso, nowMs)
  const clock = selectDeployLogClock(rawLines, generations)
  if (!clock) return spanned
  const n = deployLogClockPrefix(rawLines, clock)
  if (n === 0 || (n < clock.length && n < rawLines.length)) return spanned
  if (!deployLogClockHasVariedTimes(clock, n)) return spanned
  const changeAt = firstChangedClockIndex(clock, n)
  return spanned.map((line, i) => {
    if (i < changeAt || i >= n) return line
    const ms = clock[i]?.ms ?? 0
    if (ms <= 0) return line
    if (deployLogLineHasLeadingWallTimestamp(rawLines[i] ?? "")) return rawLines[i] ?? line
    return `[${formatInstantForDeployLog(ms)}] ${rawLines[i]}`
  })
}

/**
 * Stamp lines when this process first sees them.
 * `previousStamped` is the last result for the same Ludus log text. Those stamps
 * stay. Lines appended since then share `observedAtMs`. A log that is not an
 * append of that text is stamped again from the first changed line.
 */
export function stampObservedDeployLines(
  previousStamped: string[],
  rawLines: string[],
  observedAtMs: number,
): string[] {
  const stamp = formatInstantForDeployLog(observedAtMs)
  const prevBodies = previousStamped.map((line) => splitLeadingWallTimestamp(line).body)
  let prefix = 0
  const limit = Math.min(prevBodies.length, rawLines.length)
  while (prefix < limit && prevBodies[prefix] === rawLines[prefix]) prefix++
  const kept = previousStamped.slice(0, prefix)
  const fresh = rawLines.slice(prefix).map((line) => {
    if (deployLogLineHasLeadingWallTimestamp(line)) return normalizeBracketedIsoTimestampPrefix(line)
    return `[${stamp}] ${line}`
  })
  return [...kept, ...fresh]
}

export function augmentLudusDeployHistoryLines(
  lines: string[],
  startIso: string,
  endIso: string,
  nowMs: number = Date.now(),
): string[] {
  const t0 = new Date(startIso).getTime()
  const t1Raw = new Date(endIso || "").getTime()
  const hasEnd = Number.isFinite(t1Raw) && t1Raw > t0
  // No end yet: spread across the time the run has actually used.
  let t1 = hasEnd ? t1Raw : Number.isFinite(nowMs) && nowMs > t0 ? nowMs : t0
  if (Number.isFinite(nowMs) && t1 > nowMs) t1 = Math.max(t0, nowMs)
  let span = Math.max(0, t1 - t0)
  if (span > HISTORY_INTERPOLATE_MAX_SPAN_MS) span = HISTORY_INTERPOLATE_MAX_SPAN_MS

  const augmentableIdx: number[] = []
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith("---")) return
    if (lineLooksTimestamped(line)) return
    augmentableIdx.push(i)
  })
  const m = augmentableIdx.length

  return lines.map((line, i) => {
    const pos = augmentableIdx.indexOf(i)
    if (pos < 0) return normalizeBracketedIsoTimestampPrefix(line)
    const frac = m <= 1 ? 0 : pos / (m - 1)
    const ms = t0 + frac * span
    const ts = formatInstantForDeployLog(ms)
    return `[${ts}] ${line}`
  })
}

/** Leading `[YYYY-MM-DDTHH:mm:ss…]` (UTC Ludus / old augment) → same TZ style as live Range Logs. */
export function normalizeBracketedIsoTimestampPrefix(line: string): string {
  const m = line.match(
    /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}|[+-]\d{4})?)\]\s?([\s\S]*)$/,
  )
  if (!m) return line
  let inner = m[1] ?? ""
  const rest = m[2] ?? ""
  if (!/[zZ+-]/.test(inner)) inner = `${inner}Z`
  const parsed = Date.parse(inner)
  if (!Number.isFinite(parsed)) return line
  return `[${formatInstantForDeployLog(parsed)}] ${rest}`
}

/** Cyan wall-clock prefix — same visual language as Range Logs live stream. */
export const LOG_PANE_WALL_CLOCK_CLASS = "text-cyan-400 tabular-nums select-none"

/**
 * Remove Ludus/GOAD SSE role prefix so log panes stay plain terminal text
 * (no [L]/[G]/[E] badges). Safe: does not strip Ansible `[TASK …]` headers.
 */
export function stripStreamRolePrefix(line: string): string {
  return line.replace(/^\[(?:LUDUS|GOAD|ERROR)\]\s/, "")
}
