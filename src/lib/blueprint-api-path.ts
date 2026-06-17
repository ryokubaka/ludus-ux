export { ludusBlueprintApiPath as ludusBlueprintPath } from "@/lib/ludus-blueprint-proxy-path"

const BLUEPRINT_INSTALL_NAME_RE = /^[a-zA-Z0-9._-]{1,120}$/

export function isBlueprintInstallName(name: string): boolean {
  return BLUEPRINT_INSTALL_NAME_RE.test(name)
}

/** Resolve git folder slug for install — never use manifest display titles. */
export function blueprintInstallNameFromFields(
  fields: { name?: string; sourceBlueprintID?: string; id?: string; path?: string },
): string {
  const fromPath = fields.path
    ?.replace(/^\.?\/?blueprints\//, "")
    .split("/")
    .filter(Boolean)[0]
  if (fromPath && isBlueprintInstallName(fromPath)) return fromPath

  for (const candidate of [fields.sourceBlueprintID, fields.id, fields.name]) {
    const value = candidate?.trim()
    if (!value) continue
    const slash = value.lastIndexOf("/")
    const tail = slash >= 0 ? value.slice(slash + 1) : value
    if (isBlueprintInstallName(tail)) return tail
  }

  return fields.name?.trim() || ""
}
