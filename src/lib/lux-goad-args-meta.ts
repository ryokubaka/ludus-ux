/**
 * LUX-only flags on GOAD execute `args` (stored on the task for history titles).
 * Stripped before SSH / goad.sh so GOAD never sees them.
 */

const LUX_INSTALL_EXT_RE = /\s*--lux-install-extension=([^\s]+)/g

/** Extension name from `--lux-install-extension=name`, if present. */
export function parseLuxInstallExtension(goadArgs: string): string | undefined {
  const m = /--lux-install-extension=([^\s]+)/.exec(goadArgs)
  return m?.[1]?.trim() || undefined
}

/** Remove LUX meta flags; return args safe for goad.sh / streamGoadCommand. */
export function stripLuxGoadArgsMeta(goadArgs: string): string {
  return goadArgs.replace(LUX_INSTALL_EXT_RE, "").trim()
}

/** Append history marker so rows title as `Install extension: <name>`. */
export function withLuxInstallExtension(goadArgs: string, extensionName: string): string {
  const name = extensionName.trim()
  if (!name) return goadArgs
  const base = stripLuxGoadArgsMeta(goadArgs)
  return `${base} --lux-install-extension=${name}`
}
