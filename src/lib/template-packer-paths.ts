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
 * Run `ludus templates add` over root SSH with the caller's Ludus API key.
 * No sudo/runuser/su — LUX already SSHs as root; user-switching breaks on
 * hosts without sudo and is unnecessary for registration.
 */
export function buildLudusTemplateAddCmd(destDir: string, ludusApiKey: string): string {
  const safeDir = shellSingleQuote(destDir)
  const safeKey = ludusApiKey.replace(/'/g, "'\\''")
  return `env LUDUS_VERSION=2 LUDUS_API_KEY='${safeKey}' ludus templates add -d ${safeDir}`
}

/** Ludus DELETE /template/{name} returns HTTP 200 but refuses to remove shared packer dirs. */
export function isLudusTemplateDeleteRefused(message: string): boolean {
  return /cannot be deleted|included template/i.test(message)
}

/**
 * Disk folder often lacks `-template` while Ludus list name comes from Packer `vm_name`.
 * Returns both forms so SSH cleanup can hit the real directory.
 */
export function templateDirNameAliases(templateName: string): string[] {
  const n = templateName.trim()
  if (!n) return []
  const out = new Set<string>([n])
  const suffix = "-template"
  if (n.endsWith(suffix) && n.length > suffix.length) {
    out.add(n.slice(0, -suffix.length))
  } else {
    out.add(`${n}${suffix}`)
  }
  return [...out]
}

/**
 * Root SSH: remove template dirs under shared packer and per-user packer trees.
 * Matches list name and catalog-dir aliases; also finds dirs via Packer `vm_name`.
 * `templateName` must already match a safe charset (letters, digits, ._-).
 */
export function buildLudusTemplateDeleteCmd(ludusRoot: string, templateName: string): string {
  const root = ludusRoot.replace(/\/$/, "")
  const aliases = templateDirNameAliases(templateName)
  // NAME_RE already restricts charset; strip quotes anyway for NAMES=...
  const namesList = aliases.map((a) => a.replace(/["'\\$`]/g, "")).filter(Boolean).join(" ")
  // sh: rm by dir name aliases, then find any remaining pkr whose vm_name matches.
  const script = [
    `ROOT=${shellSingleQuote(root)}`,
    `NAMES=${shellSingleQuote(namesList)}`,
    `for name in $NAMES; do`,
    `  rm -rf "$ROOT/packer/$name" "$ROOT/packer/templates/$name"`,
    `  for d in "$ROOT/users"/*/packer; do [ -d "$d" ] && rm -rf "$d/$name"; done`,
    `done`,
    `for base in "$ROOT/packer" "$ROOT/packer/templates" "$ROOT/users"/*/packer; do`,
    `  [ -d "$base" ] || continue`,
    `  find "$base" -mindepth 1 -maxdepth 3 -type f \\( -name '*.pkr.hcl' -o -name '*.pkr.json' \\) 2>/dev/null | while read -r f; do`,
    `    for name in $NAMES; do`,
    `      if grep -qE "vm_name[[:space:]]*=[[:space:]]*\\"$name\\"|\\"vm_name\\"[[:space:]]*:[[:space:]]*\\"$name\\"" "$f" 2>/dev/null; then`,
    `        rm -rf "$(dirname "$f")"; break`,
    `      fi`,
    `    done`,
    `  done`,
    `done`,
    `echo ok`,
  ].join("\n")
  return `bash -lc ${shellSingleQuote(script)}`
}
