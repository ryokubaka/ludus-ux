import { stripRangeIdHostnames } from "@/lib/range/hostname-range-id"

/** Ludus range-config template token for the target range ID. */
export const RANGE_ID_TEMPLATE = /\{\{\s*range_id\s*\}\}/g

/**
 * Replace `{{ range_id }}` placeholders before uploading blueprint YAML to a range.
 * Hostnames lose the token. `vm_name` still receives the range id.
 */
export function substituteRangeIdInConfig(yaml: string, rangeId: string): string {
  const stripped = stripRangeIdHostnames(yaml)
  const id = rangeId.trim()
  if (!id) return stripped
  return stripped.replace(RANGE_ID_TEMPLATE, id)
}

/** True when YAML still contains unresolved Ludus range template tokens. */
export function hasUnresolvedRangeIdTemplate(yaml: string): boolean {
  return /\{\{\s*range_id\s*\}\}/.test(yaml)
}
