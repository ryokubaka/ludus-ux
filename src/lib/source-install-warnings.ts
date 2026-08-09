/** Rewrite Ludus source-install template messages for accuracy. */
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

export function rewriteSourceInstallWarnings(warnings: string[]): string[] {
  return warnings.map(rewriteSourceInstallWarning)
}
