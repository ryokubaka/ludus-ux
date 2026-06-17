export interface RegisteredLudusSource {
  id: string
  name?: string
  url?: string
  ref?: string
}

export function mapRegisteredSources(
  rows: Array<{ sourceID?: string; id?: string; name?: string; url?: string; ref?: string }>,
): RegisteredLudusSource[] {
  return rows
    .map((r) => ({
      id: (r.sourceID || r.id || "").trim(),
      name: r.name,
      url: r.url,
      ref: r.ref,
    }))
    .filter((r) => r.id)
}

export function pickDefaultRegisteredSource(
  sources: RegisteredLudusSource[],
): RegisteredLudusSource | null {
  if (sources.length === 0) return null
  const badsl = sources.find((s) => (s.url ?? "").toLowerCase().includes("ludus-source-bsl"))
  return badsl ?? sources[0]
}

export function registeredSourceLabel(source: RegisteredLudusSource): string {
  if (source.name?.trim()) return source.name.trim()
  if (source.url?.trim()) {
    try {
      const u = new URL(source.url.replace(/\.git$/, ""))
      const parts = u.pathname.split("/").filter(Boolean)
      if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    } catch {
      /* ignore */
    }
  }
  return source.id
}

/** Directory name for install/API — strips `sourceID/` prefix; ignores manifest display titles. */
export function blueprintShortName(
  row: { name?: string; sourceBlueprintID?: string; id?: string },
): string {
  for (const field of [row.sourceBlueprintID, row.id]) {
    const value = field?.trim()
    if (!value) continue
    const slash = value.lastIndexOf("/")
    if (slash >= 0) return value.slice(slash + 1)
    if (/^[a-zA-Z0-9._-]+$/.test(value)) return value
  }
  const name = row.name?.trim() ?? ""
  const slash = name.lastIndexOf("/")
  if (slash >= 0) return name.slice(slash + 1)
  return name
}

export function sourceBlueprintInstallId(
  row: { sourceBlueprintID?: string; id?: string; name?: string },
  sourceID: string,
): string {
  if (row.sourceBlueprintID?.includes("/")) return row.sourceBlueprintID
  if (row.id?.includes("/")) return row.id
  const short = blueprintShortName(row)
  return short ? `${sourceID}/${short}` : row.sourceBlueprintID || row.id || ""
}
