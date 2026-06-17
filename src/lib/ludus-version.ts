/** Parse leading semver from Ludus version strings (e.g. "2.1.2", "v2.2.0-rc1"). */
export function parseLudusSemver(raw: string): [number, number, number] | null {
  const m = String(raw).match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function ludusVersionAtLeast(
  raw: string,
  major: number,
  minor: number,
  patch = 0,
): boolean {
  const v = parseLudusSemver(raw)
  if (!v) return false
  if (v[0] !== major) return v[0] > major
  if (v[1] !== minor) return v[1] > minor
  return v[2] >= patch
}

/** Ludus 2.2.0+ supports POST /ansible/collection with action: remove. */
export function ludusSupportsCollectionRemove(version: string): boolean {
  return ludusVersionAtLeast(version, 2, 2, 0)
}

/** Ludus 2.2.0+ Sources API (/sources, sync, install). */
export function ludusSupportsSources(version: string): boolean {
  return ludusVersionAtLeast(version, 2, 2, 0)
}

/**
 * Older Ludus ignores action: remove and runs install — ansible then reports
 * "already installed" / "nothing to do".
 */
export function isCollectionRemoveMisroute(error: string | undefined, status: number): boolean {
  if (status === 404) return true
  if (!error) return false
  return /action.*remove|unknown action|not supported|already installed|nothing to do|all requested collections/i.test(
    error,
  )
}

export function collectionRemoveUnavailableMessage(): string {
  return "Collection removal requires Ludus 2.2.0 or newer. This server handled the request as a collection install instead."
}

/** Short user-facing text from noisy ansible CLI output. */
export function ansibleMessageSummary(message: string, maxLen = 220): string {
  const trimmed = message.trim()
  if (!trimmed) return "Request failed"
  if (isCollectionRemoveMisroute(trimmed, 0)) return collectionRemoveUnavailableMessage()

  const lines = trimmed
    .split("\n")
    .map((l) => l.replace(/^\[WARNING\]:?\s*/i, "").trim())
    .filter(Boolean)

  const candidate = lines.find((l) => /error|failed|unable|cannot|not found/i.test(l)) ?? lines.at(-1) ?? trimmed
  return candidate.length <= maxLen ? candidate : `${candidate.slice(0, maxLen - 1)}…`
}
