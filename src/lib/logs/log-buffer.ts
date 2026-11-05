/** Max lines kept in memory for streaming UIs (terminal, deploy logs, etc.). */
export const MAX_STREAM_LOG_LINES = 15_000

/** Application log viewer: rolling window for live stream. */
export const MAX_APP_LOG_STREAM_LINES = 500

/** Application log viewer: cap total loaded history (stream + paginated older). */
export const MAX_APP_LOG_LOADED_LINES = 2_000

export const APP_LOG_PAGE_SIZE = 200

export function appendStreamLines(prev: string[], chunk: string | string[]): string[] {
  const extra = Array.isArray(chunk) ? chunk : [chunk]
  const combined = prev.length + extra.length
  if (combined <= MAX_STREAM_LOG_LINES) return [...prev, ...extra]
  return [...prev, ...extra].slice(-MAX_STREAM_LOG_LINES)
}

export function appendAppLogStreamLines(prev: string[], chunk: string | string[]): string[] {
  const extra = Array.isArray(chunk) ? chunk : [chunk]
  const combined = [...prev, ...extra]
  if (combined.length <= MAX_APP_LOG_STREAM_LINES) return combined
  return combined.slice(-MAX_APP_LOG_STREAM_LINES)
}

export function prependAppLogHistoryLines(prev: string[], older: string[]): string[] {
  if (older.length === 0) return prev
  const combined = [...older, ...prev]
  if (combined.length <= MAX_APP_LOG_LOADED_LINES) return combined
  return combined.slice(0, MAX_APP_LOG_LOADED_LINES)
}

/** ISO timestamp prefix from a formatted app log line. */
export function parseAppLogLineTs(line: string): number | null {
  const m = line.match(/^\[([^\]]+)\]/)
  if (!m) return null
  const t = Date.parse(m[1])
  return Number.isNaN(t) ? null : t
}
