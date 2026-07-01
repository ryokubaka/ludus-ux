import { isSourceCatalogBlueprintId } from "@/lib/blueprint-list-normalize"

/**
 * Authorization for deleting a blueprint.
 *
 * Source-catalog (global) blueprints are shared/server-managed, so only admins
 * may delete them. Personal blueprints (non-source IDs) may be deleted by any
 * authenticated user (Ludus still enforces ownership via the API key).
 */
export function canDeleteBlueprint(
  session: { isAdmin?: boolean },
  blueprintId: string,
): boolean {
  if (isSourceCatalogBlueprintId(blueprintId)) return Boolean(session.isAdmin)
  return true
}
