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

/**
 * Run `ludus templates add` over host SSH with the caller's Ludus API key.
 * The command itself does not switch users. When PROXMOX_SSH_USER is not root,
 * the SSH helper runs it with `sudo -n /usr/local/sbin/lux-host`.
 */
export function buildLudusTemplateAddCmd(destDir: string, ludusApiKey: string): readonly string[] {
  return ["ludus-template-add", destDir, ludusApiKey]
}

/** Ludus DELETE /template/{name} returns HTTP 200 but refuses to remove shared packer dirs. */
export function isLudusTemplateDeleteRefused(message: string): boolean {
  return /cannot be deleted|included template/i.test(message)
}

/**
 * Disk folder often lacks `-template` (and sometimes `-x64`) while Ludus list name
 * comes from Packer `vm_name`. Example: list `securityonion-2.4-x64-template` vs
 * source dir `securityonion-2.4`.
 */
export function templateDirNameAliases(templateName: string): string[] {
  const n = templateName.trim()
  if (!n) return []
  const out = new Set<string>([n])
  const suffix = "-template"
  let base = n
  if (n.endsWith(suffix) && n.length > suffix.length) {
    base = n.slice(0, -suffix.length)
    out.add(base)
  } else {
    out.add(`${n}${suffix}`)
  }
  // Catalog dirs often omit arch: securityonion-2.4-x64 → securityonion-2.4
  const noArch = base.replace(/-(x64|amd64|arm64)$/i, "")
  if (noArch && noArch !== base) {
    out.add(noArch)
  }
  return [...out]
}

/** Unregister template via Ludus CLI (needed when API soft-refuses shared packer). */
export function buildLudusTemplateRmCliCmd(templateName: string, ludusApiKey: string): readonly string[] {
  return ["ludus-template-rm", templateName, ludusApiKey]
}

/**
 * Root SSH: remove alias dirs under packer, packer/templates, per-user packer, and source mirrors.
 * The first name is the Ludus list name. lux-host matches Packer `vm_name` to that name only,
 * and only on those install trees.
 * `templateName` must already match a safe charset (letters, digits, ._-).
 */
export function buildLudusTemplateDeleteCmd(_ludusRoot: string, templateName: string): readonly string[] {
  const listName = templateName.trim()
  const aliases = templateDirNameAliases(listName).filter((name) => name !== listName)
  return ["template-purge", ...(listName ? [listName, ...aliases] : [])]
}
