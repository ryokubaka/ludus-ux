/**
 * Ludus registers and builds a template by the Packer `vm_name` (`debian-13-x64-server-template`).
 * Official sources keep a shorter directory (`templates/debian13`). Those are different strings.
 */

const TEMPLATE_NAME_RE = /^[a-zA-Z0-9._-]{1,120}$/

/** `variable "vm_name" { default = "…" }`, ignoring `${…}` interpolations. */
export function parsePackerVmName(hcl: string): string | null {
  const block = /variable\s+"vm_name"\s*\{([\s\S]*?)\n\}/.exec(hcl)?.[1]
  if (block) {
    const fromDefault = /default\s*=\s*"([^"]+)"/.exec(block)?.[1]?.trim()
    if (fromDefault && isLudusTemplateName(fromDefault)) return fromDefault
  }
  for (const match of hcl.matchAll(/(?:^|\n)\s*vm_name\s*=\s*"([^"]+)"/g)) {
    const value = match[1]?.trim()
    if (value && isLudusTemplateName(value)) return value
  }
  return null
}

export function isLudusTemplateName(name: string): boolean {
  return TEMPLATE_NAME_RE.test(name) && !name.includes("${")
}

/** One on-disk packer folder: template-name charset, and not `.` or `..`. */
function isSafePackerDirName(name: string): boolean {
  return name !== "." && name !== ".." && isLudusTemplateName(name)
}

/** Install/build id. Falls back to the git directory when the Packer file has no literal vm_name. */
export function ludusTemplateInstallName(dirName: string, packerSource: string | null | undefined): string {
  const parsed = packerSource ? parsePackerVmName(packerSource) : null
  return parsed || dirName
}

/**
 * On-disk folder under `packer/`. `templates/debian13` stays `debian13` even when
 * the install name is `debian-13-x64-server-template`.
 * Null when that folder is not one safe directory name.
 */
export function packerDirFromTemplatePath(templatePath: string, fallbackName: string): string | null {
  const base = templatePath.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? ""
  const candidate = !base || base === "templates" ? fallbackName : base
  if (!isSafePackerDirName(candidate)) return null
  return candidate
}
