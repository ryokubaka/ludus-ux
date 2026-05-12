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
} from "./ludus-wall-clock-bridge"

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
 * When `start` and `end` are identical (common until Ludus fills `end`), stamps step
 * by ~1s per line (order hints, capped), not true wall time.
 */
const HISTORY_INTERPOLATE_MIN_GAP_MS = 1000
const HISTORY_INTERPOLATE_MAX_SPAN_MS = 6 * 60 * 60 * 1000

export function augmentLudusDeployHistoryLines(
  lines: string[],
  startIso: string,
  endIso: string,
): string[] {
  const t0 = new Date(startIso).getTime()
  const t1Raw = new Date(endIso || startIso).getTime()
  const t1 = Number.isFinite(t1Raw) && t1Raw > t0 ? t1Raw : t0
  let span = Math.max(0, t1 - t0)

  const augmentableIdx: number[] = []
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith("---")) return
    if (lineLooksTimestamped(line)) return
    augmentableIdx.push(i)
  })
  const m = augmentableIdx.length
  if (m > 1 && span < 1) {
    span = Math.min(
      HISTORY_INTERPOLATE_MAX_SPAN_MS,
      Math.max(span, (m - 1) * HISTORY_INTERPOLATE_MIN_GAP_MS),
    )
  }

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
