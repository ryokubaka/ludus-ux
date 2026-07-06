import { extractConfigRoleRefs } from "./blueprint-dependencies"

export const USER_DEFINED_ROLES_TAG = "user-defined-roles" as const

/** Parse comma-separated role names; trims, drops empties, dedupes preserving order. */
export function parseOnlyRolesCsv(csv: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of csv.split(",")) {
    const trimmed = part.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

/** Role names from range-config `ludus[].roles` and `depends_on.role`, sorted for display. */
export function parseSelectableDeployOnlyRoles(configYaml: string): string[] {
  return [...new Set(extractConfigRoleRefs(configYaml))].sort((a, b) => a.localeCompare(b))
}

/** Resolve Ludus `only_roles` array: custom CSV overrides checkbox selection. */
export function resolveDeployOnlyRoles(
  selected: string[],
  customCsv?: string,
): string[] | undefined {
  const custom = customCsv?.trim()
  if (custom) {
    const parsed = parseOnlyRolesCsv(custom)
    return parsed.length > 0 ? parsed : undefined
  }
  if (selected.length === 0) return undefined
  return [...selected]
}

/** When only-roles are set, ensure `user-defined-roles` is in the tag list (Ludus requirement). */
export function ensureUserDefinedRolesTag(
  tags: string[] | undefined,
  onlyRoles: string[] | undefined,
): string[] | undefined {
  if (!onlyRoles?.length) {
    return tags && tags.length > 0 ? tags : undefined
  }
  const base = tags ?? []
  if (base.includes(USER_DEFINED_ROLES_TAG)) {
    return base.length > 0 ? base : [USER_DEFINED_ROLES_TAG]
  }
  return [...base, USER_DEFINED_ROLES_TAG]
}
