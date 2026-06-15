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
  ok:          (n) => n > 0 ? "text-status-success"         : "text-gray-500",
  changed:     (n) => n > 0 ? "text-status-warning"        : "text-gray-500",
  unreachable: (n) => n > 0 ? "text-status-error"           : "text-gray-500",
  failed:      (n) => n > 0 ? "text-status-error font-bold" : "text-gray-500",
  skipped:     (n) => n > 0 ? "text-primary"          : "text-gray-500",
  rescued:     (n) => n > 0 ? "text-status-success"         : "text-gray-500",
  ignored:     (n) => n > 0 ? "text-status-warning"        : "text-gray-500",
}

/** Log pane theme (toolbar sun/moon) — distinct from app `dark` mode. */
export type AnsibleLogTheme = "dark" | "light"

/** Map dark-on-charcoal Ansible classes to readable light-background equivalents. */
export function ansibleClassForTheme(cls: string, theme: AnsibleLogTheme): string {
  if (theme === "dark") return cls
  const light: Record<string, string> = {
    "text-foreground": "text-black",
    "text-muted-foreground": "text-gray-600",
    "text-white font-semibold": "text-black font-semibold",
    "text-status-success": "text-green-800",
    "text-status-warning": "text-yellow-800",
    "text-status-error": "text-red-700",
    "text-status-error font-bold": "text-red-800 font-bold",
    "text-primary": "text-cyan-800",
    "text-status-info": "text-blue-800",
    "text-yellow-500 font-bold": "text-yellow-800 font-bold",
  }
  return light[cls] ?? cls
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

export function parseRecapStats(line: string, theme: AnsibleLogTheme = "dark"): RecapSegment[] {
  const colonIdx = line.indexOf(" : ")
  if (colonIdx === -1) {
    return [{ text: line, cls: ansibleClassForTheme("text-foreground", theme) }]
  }

  const hostname = line.slice(0, colonIdx)
  const rest     = line.slice(colonIdx) // " : ok=5   changed=1 …"

  const hasFailed      = /\bfailed=[1-9]/.test(line)
  const hasUnreachable = /\bunreachable=[1-9]/.test(line)
  const hostCls = (hasFailed || hasUnreachable) ? "text-status-error" : "text-status-success"

  const segments: RecapSegment[] = [{ text: hostname, cls: ansibleClassForTheme(hostCls, theme) }]
  const statPat = /\b(ok|changed|unreachable|failed|skipped|rescued|ignored)=(\d+)\b/g
  let cursor = 0
  let m: RegExpExecArray | null

  while ((m = statPat.exec(rest)) !== null) {
    if (m.index > cursor)
      segments.push({
        text: rest.slice(cursor, m.index),
        cls: ansibleClassForTheme("text-muted-foreground", theme),
      })
    const n   = parseInt(m[2], 10)
    const cls = (RECAP_STAT_COLOR[m[1]] ?? (() => "text-muted-foreground"))(n)
    segments.push({ text: m[0], cls: ansibleClassForTheme(cls, theme) })
    cursor = m.index + m[0].length
  }
  if (cursor < rest.length)
    segments.push({
      text: rest.slice(cursor),
      cls: ansibleClassForTheme("text-muted-foreground", theme),
    })

  return segments
}

function ansibleLineClassDark(line: string): string {
  const lower = line.toLowerCase()

  // Strip leading timestamp "[HH:MM:SS] " so PLAY/TASK headers are still
  // detected when Ansible is run with -v or GOAD injects timestamps.
  const content = lower.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")

  // Ansible section headers: "PLAY [name] ****", "TASK [name] ****",
  // "PLAY RECAP ****", "RUNNING HANDLER [name] ****"
  if (/^(play|task|running handler)\s/.test(content)) return "text-white font-semibold"

  // Fatal / unreachable — Ansible uses "fatal:" and "UNREACHABLE!" (exclamation)
  if (lower.includes("[fatal]") || lower.includes("fatal:")) return "text-status-error font-bold"
  if (lower.includes("unreachable:") || lower.includes("unreachable!")) return "text-status-error font-bold"

  // Ansible task result prefixes **before** failure heuristics — JSON often contains
  // `"failed": false` / `failed_when_result`, which must not paint the whole line red.
  if (lower.includes("changed:")) return "text-status-warning"
  if (lower.includes("[ok]") || lower.includes("ok:")) return "text-status-success"
  if (lower.includes("skipping:")) return "text-primary"

  if (lower.includes("[warning]") || lower.includes("warn:")) return "text-status-warning"

  if (lower.includes("[error]") || lower.includes("error:")) return "text-status-error"
  if (/"failed"\s*:\s*true/.test(lower)) return "text-status-error"
  if (/\bfailed!/i.test(lower)) return "text-status-error"

  const forFailedProbe = lower
    .replace(/"failed"\s*:\s*false/gi, "")
    .replace(/\bfailed_when_result\b/gi, "when_result")
  if (/\bfailed\b/.test(forFailedProbe) && !/\bfailed=\d/.test(forFailedProbe)) return "text-status-error"

  // GOAD / Ludus bracket-style control messages ("[INFO]", "[RECAP]", …)
  if (lower.includes("[play]") || lower.includes("[task]") || lower.includes("[recap]")) return "text-white font-semibold"
  if (lower.includes("[info]") || lower.includes("info:")) return "text-status-info"

  // Arrow-prefixed lines: Molecule "---> Scenario:", GOAD "->", "=>"
  if (/^-+>/.test(lower) || lower.startsWith("=>")) return "text-primary"

  if (lower.includes("[exit]")) return "text-status-warning font-bold"
  return "text-foreground"
}

/** Colour class for a single Ansible/Ludus log line (non-RECAP-stats). */
export function getAnsibleLineClass(line: string, theme: AnsibleLogTheme = "dark"): string {
  return ansibleClassForTheme(ansibleLineClassDark(line), theme)
}
