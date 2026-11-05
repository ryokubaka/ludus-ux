/** Normalize one physical line for cross-source dedupe (Ludus API vs GOAD ansible.log). */
export function normalizeDeployLogDedupeKey(s: string): string {
  return s.replace(/\r$/, "").trimEnd()
}

const MAX_KEYS = 12_000

export function createDeployLogDedupe() {
  const seen = new Set<string>()
  return {
    remember(raw: string) {
      const k = normalizeDeployLogDedupeKey(raw)
      if (!k) return
      if (seen.size > MAX_KEYS) seen.clear()
      seen.add(k)
    },
    isDuplicate(raw: string): boolean {
      const k = normalizeDeployLogDedupeKey(raw)
      if (!k) return false
      return seen.has(k)
    },
  }
}
