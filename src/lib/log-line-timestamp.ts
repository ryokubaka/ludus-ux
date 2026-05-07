/**
 * Wall-clock timestamps for streamed / persisted log lines (GOAD task store,
 * Ludus deploy SSE, history replay).
 *
 * Live paths prefer the Ludus host clock when a server route has pushed a sample
 * into `ludus-wall-clock-bridge.ts`; otherwise UTC.
 */

import { getCachedLudusWallHmsOrUtc } from "./ludus-wall-clock-bridge"

const HMS_IN_BRACKETS = /^\[\d{2}:\d{2}:\d{2}\]/

/** `HH:MM:SS` on Ludus when cache is warm; else UTC (same bracket shape as SSE). */
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
  if (HMS_IN_BRACKETS.test(line.trimStart())) return line
  return `[${formatStreamWallHms()}] ${line}`
}

function lineLooksTimestamped(line: string): boolean {
  const t = line.trimStart()
  if (HMS_IN_BRACKETS.test(t)) return true
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return true
  if (/^\d{4}\/\d{2}\/\d{2}/.test(t)) return true
  return false
}

/**
 * Split `[HH:MM:SS]` wall prefix (from SSE or GOAD store) from the rest of the line.
 */
export function splitLeadingWallTimestamp(line: string): { ts: string | null; body: string } {
  // Avoid RegExp `s` (dotAll) — Docker/tsconfig may target < ES2018.
  const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s([\s\S]*)$/)
  if (m) return { ts: m[1], body: m[2] }
  return { ts: null, body: line }
}

/**
 * Ludus GET /range/logs/history/{id} returns plain `result` text — no per-line
 * timestamps like the live SSE panel. Interpolate `[HH:MM:SS]` between `start`
 * and `end` so history matches the deploy window style (order-preserving, not
 * wall-accurate per line).
 */
export function augmentLudusDeployHistoryLines(
  lines: string[],
  startIso: string,
  endIso: string,
): string[] {
  const t0 = new Date(startIso).getTime()
  const t1Raw = new Date(endIso || startIso).getTime()
  const t1 = Number.isFinite(t1Raw) && t1Raw > t0 ? t1Raw : t0
  const span = Math.max(0, t1 - t0)

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
    if (pos < 0) return line
    const frac = m <= 1 ? 0 : pos / (m - 1)
    const ts = new Date(t0 + frac * span).toISOString().slice(11, 19)
    return `[${ts}] ${line}`
  })
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
