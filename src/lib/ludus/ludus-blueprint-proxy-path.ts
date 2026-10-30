/** Known Ludus blueprint sub-routes after `{blueprintID}`. */
const BLUEPRINT_SUBPATHS = [
  "access/users",
  "access/groups",
  "share/users",
  "share/groups",
  "config",
  "apply",
  "copy",
  "install",
] as const

/** Decode once so proxy segments like `foo%2Fbar` are not double-encoded for Ludus. */
export function normalizeBlueprintIdParam(blueprintId: string): string {
  const trimmed = blueprintId.trim()
  if (!trimmed) return ""
  if (!trimmed.includes("%")) return trimmed
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

/**
 * Ludus OpenAPI defines `{blueprintID}` as a single path parameter. Source blueprint
 * IDs look like `ludus-source-bsl/ad-elastic-range` and must be sent encoded as one
 * segment (`%2F`), not `/blueprints/ludus-source-bsl/ad-elastic-range`.
 */
export function ludusBlueprintApiPath(blueprintId: string, ...subpaths: string[]): string {
  const raw = normalizeBlueprintIdParam(blueprintId)
  const base = `/blueprints/${encodeURIComponent(raw)}`
  if (subpaths.length === 0) return base
  const suffix = subpaths
    .flatMap((part) => part.split("/").filter(Boolean))
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${base}/${suffix}`
}

/** Rewrite `/api/proxy/...` catch-all segments into a Ludus-safe blueprint path. */
export function normalizeLudusProxyPath(segments: string[]): string {
  if (segments.length === 0) return "/"
  if (segments[0] !== "blueprints") {
    return `/${segments.join("/")}`
  }

  for (const suffix of BLUEPRINT_SUBPATHS) {
    const suffixParts = suffix.split("/")
    if (segments.length <= suffixParts.length + 1) continue
    const tail = segments.slice(-suffixParts.length).join("/")
    if (tail !== suffix) continue
    const idParts = segments.slice(1, segments.length - suffixParts.length)
    const blueprintID = normalizeBlueprintIdParam(idParts.join("/"))
    return ludusBlueprintApiPath(blueprintID, suffix)
  }

  if (segments.length >= 2) {
    const blueprintID = normalizeBlueprintIdParam(segments.slice(1).join("/"))
    return ludusBlueprintApiPath(blueprintID)
  }

  return `/${segments.join("/")}`
}
