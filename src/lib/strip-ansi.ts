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
      // Literal SGR when ESC byte was lost (common in Ludus packer log storage)
      .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?m/g, "")
      // Carriage-return overwrites — keep last segment on the line
      .replace(/^.*\r(?!\n)/gm, "")
      // Other C0 controls except tab/newline
      .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
  )
}

/** Split log blob into display lines with ANSI/control chars normalized. */
export function splitLogText(text: string): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map(stripAnsi)
    .filter((line) => line.length > 0)
}
