import { ludusSourceGitRef } from "@/lib/ludus-source-ref"

export interface RegisteredLudusSource {
  id: string
  name?: string
  url?: string
  ref?: string
  /** Admin published this catalog for every user. */
  published?: boolean
  /** Shown from an admin's catalog. This user did not register it. */
  sharedCatalog?: boolean
}

export function mapRegisteredSources(
  rows: Array<{
    sourceID?: string
    id?: string
    name?: string
    url?: string
    ref?: string
    Ref?: string
    branch?: string
    Branch?: string
    gitRef?: string
    git_ref?: string
    published?: boolean
    sharedCatalog?: boolean
  }>,
): RegisteredLudusSource[] {
  return rows
    .map((r) => ({
      id: (r.sourceID || r.id || "").trim(),
      name: r.name,
      url: r.url,
      ref: ludusSourceGitRef(r),
      published: r.published === true,
      sharedCatalog: r.sharedCatalog === true,
    }))
    .filter((r) => r.id)
    .sort((a, b) =>
      registeredSourceLabel(a).localeCompare(registeredSourceLabel(b), undefined, {
        sensitivity: "base",
      }),
    )
}

export function pickDefaultRegisteredSource(
  sources: RegisteredLudusSource[],
): RegisteredLudusSource | null {
  if (sources.length === 0) return null
  const badsl = sources.find((s) => (s.url ?? "").toLowerCase().includes("ludus-source-bsl"))
  return badsl ?? sources[0]
}

export function registeredSourceOptionLabel(source: RegisteredLudusSource): string {
  const name = registeredSourceLabel(source)
  if (source.sharedCatalog || source.published) return `${name} · all users`
  return name
}

export function registeredSourceLabel(source: RegisteredLudusSource): string {
  let base = source.id
  if (source.name?.trim()) base = source.name.trim()
  else if (source.url?.trim()) {
    try {
      const u = new URL(source.url.replace(/\.git$/, ""))
      const parts = u.pathname.split("/").filter(Boolean)
      if (parts.length >= 2) base = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    } catch {
      /* ignore */
    }
  }
  const ref = source.ref?.trim()
  if (!ref) return base
  return `${base} · ${ref}`
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

/**
 * Same Ludus source registration, including the optional `userID-` prefix
 * (`ludus-source-bsl` and `badsectorlabs-ludus-source-bsl`).
 * A branch-specific id (`…-meow` vs `…-meow-feat-securityonion-3-3-0`) is not the same.
 */
export function sourceIdsAreSameRegistration(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  if (!left || !right) return false
  if (left === right) return true
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  if (left.length === right.length) return false
  return longer.endsWith(`-${shorter}`)
}

export function blueprintSourcePrefix(id: string): string {
  const slash = id.lastIndexOf("/")
  return slash >= 0 ? id.slice(0, slash) : ""
}

/** Installed blueprint belongs to this source (not another ref that shares the slug). */
export function installedBlueprintMatchesSource(
  installedId: string,
  shortName: string,
  sourceID: string,
): boolean {
  const id = installedId.trim()
  const short = shortName.trim()
  const source = sourceID.trim()
  if (!id || !short || !source) return false
  const slash = id.lastIndexOf("/")
  const slug = slash >= 0 ? id.slice(slash + 1) : id
  if (slug !== short) return false
  const prefix = slash >= 0 ? id.slice(0, slash) : ""
  if (!prefix) return false
  return sourceIdsAreSameRegistration(prefix, source)
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
