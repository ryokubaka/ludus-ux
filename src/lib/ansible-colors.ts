/**
 * Shared Ansible-native colour utilities used by both the GOAD terminal
 * and the Ludus range log viewer.
 *
 * Colour scheme mirrors what `ansible-playbook` outputs to a colour terminal:
 *   PLAY / TASK headers  → white bold
 *   ok:                  → green
 *   changed:             → yellow  (Ansible always yellow, never green)
 *   skipping:            → cyan
 *   fatal: / unreachable → bright red bold
 *   PLAY RECAP stats     → per-counter colours (see RECAP_STAT_COLOR)
 */

export const RECAP_STAT_COLOR: Record<string, (n: number) => string> = {
  ok:          (n) => n > 0 ? "text-green-400"         : "text-gray-500",
  changed:     (n) => n > 0 ? "text-yellow-400"        : "text-gray-500",
  unreachable: (n) => n > 0 ? "text-red-400"           : "text-gray-500",
  failed:      (n) => n > 0 ? "text-red-500 font-bold" : "text-gray-500",
  skipped:     (n) => n > 0 ? "text-cyan-400"          : "text-gray-500",
  rescued:     (n) => n > 0 ? "text-green-400"         : "text-gray-500",
  ignored:     (n) => n > 0 ? "text-yellow-400"        : "text-gray-500",
}

/** Returns true for "hostname : ok=N changed=N unreachable=N failed=N …" lines */
export function isRecapStatsLine(line: string): boolean {
  const l = line.toLowerCase()
  return /\bok=\d+/.test(l) && /\bfailed=\d+/.test(l)
}

/**
 * Parse a PLAY RECAP stats line into labelled segments so the caller can
 * render each segment with its own colour.
 *
 * Returns an array of `{ text, cls }` tuples covering the entire line
 * (including whitespace separators).
 */
export interface RecapSegment {
  text: string
  cls: string
}

export function parseRecapStats(line: string): RecapSegment[] {
  const colonIdx = line.indexOf(" : ")
  if (colonIdx === -1) return [{ text: line, cls: "text-gray-300" }]

  const hostname = line.slice(0, colonIdx)
  const rest     = line.slice(colonIdx) // " : ok=5   changed=1 …"

  const hasFailed      = /\bfailed=[1-9]/.test(line)
  const hasUnreachable = /\bunreachable=[1-9]/.test(line)
  const hostCls = (hasFailed || hasUnreachable) ? "text-red-400" : "text-green-400"

  const segments: RecapSegment[] = [{ text: hostname, cls: hostCls }]
  const statPat = /\b(ok|changed|unreachable|failed|skipped|rescued|ignored)=(\d+)\b/g
  let cursor = 0
  let m: RegExpExecArray | null

  while ((m = statPat.exec(rest)) !== null) {
    if (m.index > cursor)
      segments.push({ text: rest.slice(cursor, m.index), cls: "text-gray-400" })
    const n   = parseInt(m[2], 10)
    const cls = (RECAP_STAT_COLOR[m[1]] ?? (() => "text-gray-400"))(n)
    segments.push({ text: m[0], cls })
    cursor = m.index + m[0].length
  }
  if (cursor < rest.length)
    segments.push({ text: rest.slice(cursor), cls: "text-gray-400" })

  return segments
}

/** Colour class for a single Ansible/Ludus log line (non-RECAP-stats). */
export function getAnsibleLineClass(line: string): string {
  const lower = line.toLowerCase()

  // Strip leading timestamp "[HH:MM:SS] " so PLAY/TASK headers are still
  // detected when Ansible is run with -v or goad-mod injects timestamps.
  const content = lower.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")

  // Ansible section headers: "PLAY [name] ****", "TASK [name] ****",
  // "PLAY RECAP ****", "RUNNING HANDLER [name] ****"
  if (/^(play|task|running handler)\s/.test(content)) return "text-white font-semibold"

  // Fatal / unreachable — Ansible uses "fatal:" and "UNREACHABLE!" (exclamation)
  if (lower.includes("[fatal]") || lower.includes("fatal:")) return "text-red-500 font-bold"
  if (lower.includes("unreachable:") || lower.includes("unreachable!")) return "text-red-500 font-bold"

  // Generic errors and bare "failed" keyword (excludes stats values like failed=0)
  if (lower.includes("[error]") || lower.includes("error:") ||
      (lower.includes("failed") && !/\bfailed=\d/.test(lower))) return "text-red-400"

  if (lower.includes("[warning]") || lower.includes("warn:")) return "text-yellow-400"

  // changed: → yellow (Ansible native colour for changed tasks)
  if (lower.includes("changed:")) return "text-yellow-400"

  // skipping: → cyan (Ansible native colour for skipped tasks)
  if (lower.includes("skipping:")) return "text-cyan-400"

  // ok: → green
  if (lower.includes("[ok]") || lower.includes("ok:")) return "text-green-400"

  // GOAD / Ludus bracket-style control messages ("[INFO]", "[RECAP]", …)
  if (lower.includes("[play]") || lower.includes("[task]") || lower.includes("[recap]")) return "text-white font-semibold"
  if (lower.includes("[info]") || lower.includes("info:")) return "text-blue-400"

  // Arrow-prefixed lines: Molecule "---> Scenario:", GOAD "->", "=>"
  if (/^-+>/.test(lower) || lower.startsWith("=>")) return "text-cyan-400"

  if (lower.includes("[exit]")) return "text-yellow-500 font-bold"
  return "text-gray-300"
}
