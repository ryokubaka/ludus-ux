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

function sanitizeSourceIdPart(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
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
