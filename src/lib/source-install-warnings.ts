/**
 * Ludus reports Packer vm_name collisions as “built-in template name”.
 * That is usually wrong for source templates (e.g. securityonion-*-template already
 * on the host from a prior install). Treat those as benign noise.
 */

const BUILTIN_NAME_COLLISION =
  /matches a built-in template name and cannot be installed from a source/i

export function isBenignBuiltInTemplateNameCollision(message: string): boolean {
  return BUILTIN_NAME_COLLISION.test(message.trim())
}

/** Rewrite Ludus source-install template messages for accuracy (non-benign leftovers). */
export function rewriteSourceInstallWarning(message: string): string {
  const m = message.trim()
  const builtin = m.match(
    /template\s+"?([^"]+)"?\s+matches a built-in template name and cannot be installed from a source/i,
  )
  if (builtin) {
    const name = builtin[1]
    return (
      `Template "${name}" already exists on this Ludus host (built-in or previously installed under that Packer vm_name). ` +
      `Ludus will not overwrite it from a source. Manage it on the Templates page, or rename vm_name in the source Packer HCL ` +
      `(Ludus recommends a source-specific prefix).`
    )
  }
  if (/matches a built-in template name/i.test(m)) {
    return (
      `${m} — This usually means the Packer vm_name is already registered (not necessarily a Ludus core template). ` +
      `Rename the vm_name in the source or remove/replace the existing template on the Templates page.`
    )
  }
  return m
}

/** Drop false-positive built-in-name collisions from install warning lists. */
export function rewriteSourceInstallWarnings(warnings: string[]): string[] {
  return warnings
    .filter((w) => !isBenignBuiltInTemplateNameCollision(w))
    .map(rewriteSourceInstallWarning)
}

function splitSyncErrorParts(error: string): string[] {
  return error
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\S);\s+/))
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Clean Ludus lastSyncStatus / lastSyncError for UI + auto-sync.
 * When the only sync complaint is a false “built-in template” collision, treat as ok.
 */
export function sanitizeSourceSyncPresentation(row: {
  lastSyncStatus?: string
  lastSyncError?: string
}): { lastSyncStatus?: string; lastSyncError?: string } {
  const status = row.lastSyncStatus
  const err = (row.lastSyncError ?? "").trim()
  if (!err) {
    return { lastSyncStatus: status, lastSyncError: row.lastSyncError }
  }

  const remaining = splitSyncErrorParts(err).filter(
    (part) => !isBenignBuiltInTemplateNameCollision(part),
  )

  if (remaining.length === 0) {
    const s = (status || "").trim().toLowerCase()
    if (s === "partial" || s === "warning" || s === "error") {
      return { lastSyncStatus: "ok", lastSyncError: undefined }
    }
    return { lastSyncStatus: status, lastSyncError: undefined }
  }

  return {
    lastSyncStatus: status,
    lastSyncError: remaining.map(rewriteSourceInstallWarning).join("; "),
  }
}
