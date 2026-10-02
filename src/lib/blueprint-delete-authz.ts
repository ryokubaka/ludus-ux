import { isSourceCatalogBlueprintId } from "@/lib/blueprint-list-normalize"

/**
 * Authorization for deleting a blueprint.
 *
 * A source blueprint (`user-source/name`) belongs to its owner. That owner may
 * delete it. Admins may also delete one. Other users may not, even when the
 * blueprint was shared with them.
 */
export function canDeleteBlueprint(
  session: { isAdmin?: boolean },
  blueprintId: string,
  opts?: { owns?: boolean },
): boolean {
  if (!isSourceCatalogBlueprintId(blueprintId)) return true
  if (session.isAdmin) return true
  return opts?.owns === true
}
