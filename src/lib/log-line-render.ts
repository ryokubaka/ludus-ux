/**
 * Shared per-line parsing for the log/terminal viewers (LogViewer, GoadTerminal).
 *
 * The viewers used to run role-prefix stripping, wall-clock extraction, Ansible
 * colour classification and PLAY RECAP parsing inside their render loops on every
 * paint. This module centralizes that work into one pure function so callers can
 * compute it once per `[lines, theme]` via `useMemo` (see `parseLogLines`).
 */
import {
  isRecapStatsLine,
  parseRecapStats,
  getAnsibleLineClass,
  type AnsibleLogTheme,
} from "./ansible-colors"
import { splitLeadingWallTimestamp, stripStreamRolePrefix } from "./log-line-timestamp"

/**
 * Above this many lines the viewers switch to windowed (virtualized) rendering.
 * Below it, every line is rendered directly so small logs behave exactly as before.
 */
export const LOG_VIRTUALIZE_THRESHOLD = 500

export interface ParsedLogSegment {
  text: string
  cls: string
}

export interface ParsedLogLine {
  /** True when the (ANSI-stripped) line has no visible content. */
  isBlank: boolean
  /** Leading wall-clock timestamp, if present. */
  wallTs: string | null
  /** Line body after role-prefix + timestamp removal. */
  body: string
  /** True when the body is a PLAY RECAP stats line. */
  isRecap: boolean
  /** Coloured segments when `isRecap`; otherwise null. */
  segments: ParsedLogSegment[] | null
  /** Colour class for the body when not a recap line. */
  bodyCls: string
}

/**
 * Parse a single ANSI-stripped log line into render-ready pieces.
 * Pass the already ANSI-stripped text (callers strip once, up front).
 */
export function parseLogLine(line: string, theme: AnsibleLogTheme): ParsedLogLine {
  const isBlank = line.trim() === ""
  const isTaskId = line.startsWith("[TASKID]")
  const isErrorRole = /^\[ERROR\]\s/.test(line)
  const normalized = stripStreamRolePrefix(line)
  const { ts: wallTs, body } = splitLeadingWallTimestamp(normalized)

  if (isRecapStatsLine(body)) {
    return { isBlank, wallTs, body, isRecap: true, segments: parseRecapStats(body, theme), bodyCls: "" }
  }

  const bodyCls = isTaskId
    ? "hidden"
    : isErrorRole
      ? "text-status-error"
      : getAnsibleLineClass(body, theme)
  return { isBlank, wallTs, body, isRecap: false, segments: null, bodyCls }
}

/** Parse many lines at once (already ANSI-stripped). Memoize on `[lines, theme]`. */
export function parseLogLines(lines: string[], theme: AnsibleLogTheme): ParsedLogLine[] {
  return lines.map((line) => parseLogLine(line, theme))
}
