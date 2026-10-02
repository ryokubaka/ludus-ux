/** Default only when Ludus omits ref and the client did not specify one at register time. */
export const DEFAULT_SOURCE_GIT_REF = "main"

type SourceRefFields = {
  ref?: string | null
  Ref?: string | null
  branch?: string | null
  Branch?: string | null
  gitRef?: string | null
  git_ref?: string | null
}

/** Compare git source URLs ignoring trailing slash / `.git` / case. */
export function normalizeGitSourceUrl(url: string): string {
  return url.trim().replace(/\/$/, "").replace(/\.git$/i, "").toLowerCase()
}

/**
 * Ludus source ids must match `^[A-Za-z][A-Za-z0-9_-]*$`.
 * Dots in a branch like `feat/securityonion-3.3.0` are not allowed.
 */
export function toLudusSourceId(raw: string): string {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/^[^a-z]+/, "")
  return id
}

function sanitizeSourceIdPart(raw: string): string {
  return toLudusSourceId(raw)
}

/**
 * Ludus source IDs are `{userID}-{repo slug}`. The user prefix is who registered
 * the source. Returns that user when the id is longer than the repo-derived slug.
 */
export function ludusSourceRegistrant(
  sourceId: string,
  gitUrl?: string | null,
  ref?: string | null,
): string | null {
  const id = sourceId.trim().toLowerCase()
  const url = gitUrl?.trim()
  if (!id || !url) return null
  const suggested = suggestedLudusSourceId(url, ref?.trim() || DEFAULT_SOURCE_GIT_REF)
  if (!suggested || id === suggested) return null
  const suffix = `-${suggested}`
  if (!id.endsWith(suffix) || id.length <= suffix.length) return null
  const user = id.slice(0, id.length - suffix.length)
  return user || null
}

/** Owner to show in the UI. Prefers Ludus `ownerUserID`, then the user prefix on the source id. */
export function sourceOwnerLabel(source: {
  sourceID?: string | null
  id?: string | null
  url?: string | null
  ref?: string | null
  ownerUserID?: string | null
}): string | null {
  const explicit = source.ownerUserID?.trim()
  if (explicit) return explicit
  const id = (source.sourceID || source.id || "").trim()
  if (!id) return null
  return ludusSourceRegistrant(id, source.url, source.ref)
}

/**
 * Ludus source IDs are often derived from the repo name alone. Registering the
 * same URL twice with different refs then collides / "merges". Include the ref
 * (when not main/master) so each branch is a distinct source.
 */
export function suggestedLudusSourceId(gitUrl: string, ref: string): string {
  const cleaned = gitUrl.trim().replace(/\/$/, "").replace(/\.git$/i, "")
  const parts = cleaned.split("/").filter(Boolean)
  const orgRepo = parts.slice(-2).join("-")
  const base = sanitizeSourceIdPart(orgRepo || cleaned || "source") || "source"
  const safeRef = sanitizeSourceIdPart(ref || DEFAULT_SOURCE_GIT_REF)
  if (!safeRef || safeRef === "main" || safeRef === "master") return base
  return `${base}-${safeRef}`
}

/**
 * Git branch/tag/commit for a registered Ludus source (Sources tab `ref`).
 * Accepts common Ludus/JSON aliases; does not invent a different branch than configured.
 */
export function ludusSourceGitRef(
  source: SourceRefFields | null | undefined,
  fallback: string = DEFAULT_SOURCE_GIT_REF,
): string {
  if (!source) return fallback.trim() || DEFAULT_SOURCE_GIT_REF
  for (const key of ["ref", "Ref", "branch", "Branch", "gitRef", "git_ref"] as const) {
    const raw = source[key]
    if (typeof raw === "string" && raw.trim()) return raw.trim()
  }
  return fallback.trim() || DEFAULT_SOURCE_GIT_REF
}

/** Normalize a Ludus source row so `ref` is always the canonical field. */
export function normalizeLudusSourceRef<T extends SourceRefFields>(row: T): T & { ref: string } {
  const ref = ludusSourceGitRef(row)
  return { ...row, ref }
}
