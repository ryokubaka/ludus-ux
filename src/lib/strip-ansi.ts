/**
 * Strip terminal control sequences from log lines (Ansible, Packer, SSH streams).
 * Handles real ESC bytes and literal SGR text (e.g. `[1;32m`) when logs are stored without ESC.
 */
export function stripAnsi(text: string): string {
  return (
    text
      // CSI sequences: ESC [ … final byte
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      // OSC sequences: ESC ] … BEL or ST
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // Standalone ESC + single char
      .replace(/\x1b[^[\]]/g, "")
      .replace(/\x1b/g, "")
      // Literal SGR when ESC byte was lost (common in Ludus packer log storage).
      // Digit group is required so bare `[m` in text (e.g. `TASK [main : X]`,
      // `ok: [myhost]`) is left intact — only real SGR codes are stripped.
      .replace(/\[\d{1,3}(?:;\d{1,3})*m/g, "")
      // Carriage-return overwrites — a CR returns the cursor to column 0 so the
      // following text overwrites what preceded it. Drop each pre-CR segment only
      // when more content follows on the same line; a trailing CR (`downloading...\r`)
      // leaves its text intact instead of vanishing.
      .replace(/[^\n\r]*\r(?=[^\n\r])/g, "")
      .replace(/\r/g, "")
      // Other C0 controls except tab/newline
      .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
  )
}

/** Split log blob into display lines with ANSI/control chars normalized. */
export function splitLogText(text: string): string[] {
  if (!text) return []
  const lines = text.split(/\r?\n/).map(stripAnsi)
  // Drop only trailing blank lines (from a final newline); keep intentional
  // interior blanks that separate log phases (e.g. Packer build steps).
  while (lines.length > 0 && lines[lines.length - 1].length === 0) lines.pop()
  return lines
}
