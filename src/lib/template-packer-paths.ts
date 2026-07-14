/**
 * Ludus Packer template directory helpers for SSH template install.
 *
 * Built-in templates live under `<ludusRoot>/packer/<name>/`. Synced Ludus Sources
 * mirrors under `<ludusRoot>/sources/.../templates/` must not be used as install targets.
 */

/** Derive packer root from a `.pkr.hcl` path; null when under /sources/ or too shallow. */
export function derivePackerRootFromPkrPath(pkrPath: string): string | null {
  const normalized = pkrPath.trim()
  if (!normalized || normalized.includes("/sources/")) return null
  const parent = normalized.slice(0, normalized.lastIndexOf("/"))
  if (!parent) return null
  const root = parent.slice(0, parent.lastIndexOf("/"))
  return root || null
}

/** Candidate packer roots on a Ludus host (most likely first). */
export function packerRootCandidates(ludusRoot: string): string[] {
  const root = ludusRoot.replace(/\/$/, "")
  return [
    `${root}/packer`,
    `${root}/packer/templates`,
    `${root}/templates`,
    `${root}/packer-templates`,
    "/root/.config/ludus/packer/templates",
  ]
}

/** Ludus CLI may print [ERROR]/[FATAL] yet exit 0 when run as root with the ROOT API key. */
export function isLudusTemplateAlreadyRegistered(output: string): boolean {
  return /already present on the server/i.test(output)
}

/** Ludus CLI may print [ERROR]/[FATAL] yet exit 0 when run as root with the ROOT API key. */
export function isLudusCliTemplateAddFailure(output: string, exitCode: number): boolean {
  if (isLudusTemplateAlreadyRegistered(output)) return false
  if (exitCode !== 0) return true
  return /\[(ERROR|FATAL)\]/i.test(output)
}

/** Safe base64 chunk size for `printf` over SSH (avoids ARG_MAX / "Argument list too long"). */
export const SSH_B64_CHUNK_CHARS = 48_000

export function buildInitRemoteBase64TempCmd(tmpPath: string): string {
  return `: > ${shellSingleQuote(tmpPath)}`
}

export function buildAppendRemoteBase64ChunkCmd(tmpPath: string, chunk: string): string {
  const safeChunk = chunk.replace(/'/g, "'\\''")
  return `printf '%s' '${safeChunk}' >> ${shellSingleQuote(tmpPath)}`
}

export function buildDecodeRemoteBase64FileCmd(tmpPath: string, destPath: string): string {
  return `base64 -d ${shellSingleQuote(tmpPath)} > ${shellSingleQuote(destPath)} && rm -f ${shellSingleQuote(tmpPath)}`
}

/** Escape a Linux username for single-quoted sh strings. */
export function shellQuoteLinuxUser(user: string): string {
  return user.replace(/'/g, "'\\''")
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Run `ludus templates add` as the Ludus Linux user with their API key. */
export function buildLudusTemplateAddCmd(
  destDir: string,
  linuxUser: string,
  ludusApiKey: string,
): string {
  const safeDir = shellSingleQuote(destDir)
  const safeUser = shellQuoteLinuxUser(linuxUser.trim())
  const safeKey = ludusApiKey.replace(/'/g, "'\\''")
  return [
    `_LU='${safeUser}'`,
    `_KEY='${safeKey}'`,
    `sudo -H -u "$_LU" env LUDUS_VERSION=2 LUDUS_API_KEY="$_KEY" ludus templates add -d ${safeDir}`,
  ].join("; ")
}
