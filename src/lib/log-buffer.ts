/** Max lines kept in memory for streaming UIs (terminal, deploy logs, etc.). */
export const MAX_STREAM_LOG_LINES = 15_000

export function appendStreamLines(prev: string[], chunk: string | string[]): string[] {
  const extra = Array.isArray(chunk) ? chunk : [chunk]
  const combined = prev.length + extra.length
  if (combined <= MAX_STREAM_LOG_LINES) return [...prev, ...extra]
  return [...prev, ...extra].slice(-MAX_STREAM_LOG_LINES)
}
