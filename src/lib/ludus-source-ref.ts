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
