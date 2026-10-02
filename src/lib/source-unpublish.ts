import "server-only"

import { blueprintInstalledFromSource, normalizeBlueprintList } from "@/lib/blueprint-list-normalize"
import { ludusBlueprintApiPath } from "@/lib/ludus-blueprint-proxy-path"
import { ludusRequest } from "@/lib/ludus-client"
import {
  listSourceCollections,
  listSourceRoles,
  listSourceTemplates,
} from "@/lib/ludus-source-client"
import { sshExec } from "@/lib/goad-ssh"
import { buildLudusTemplateRmCliCmd } from "@/lib/template-packer-paths"

/**
 * Remove blueprints, templates, roles, and collections installed from a source.
 * User copies of those blueprints stay.
 */
export async function removeSourceInstalledItems(
  apiKey: string,
  sourceId: string,
): Promise<string[]> {
  const warnings: string[] = []
  const id = sourceId.trim()
  if (!id) return warnings

  const listed = await ludusRequest<unknown>("/blueprints", { apiKey })
  if (listed.error) {
    warnings.push(listed.error)
  } else {
    for (const bp of normalizeBlueprintList(listed.data)) {
      if (!blueprintInstalledFromSource(id, bp)) continue
      const blueprintId = (bp.id || bp.blueprintID || "").trim()
      if (!blueprintId) continue
      const removed = await ludusRequest(ludusBlueprintApiPath(blueprintId), {
        method: "DELETE",
        apiKey,
      })
      if (removed.error && removed.status !== 404) {
        warnings.push(`Blueprint ${blueprintId}: ${removed.error}`)
      }
    }
  }

  try {
    const templates = await listSourceTemplates(apiKey, id)
    let hostCleanupWarned = false
    for (const template of templates) {
      const name = template.name?.trim()
      if (!name) continue
      const removed = await ludusRequest(`/template/${encodeURIComponent(name)}`, {
        method: "DELETE",
        apiKey,
        timeout: 60_000,
      })
      if (removed.error && removed.status !== 404) {
        warnings.push(`Template ${name}: ${removed.error}`)
      }
      try {
        await sshExec(buildLudusTemplateRmCliCmd(name, apiKey))
      } catch {
        if (!hostCleanupWarned) {
          warnings.push("Could not remove templates on the Ludus host")
          hostCleanupWarned = true
        }
      }
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : "Could not list source templates")
  }

  try {
    const roles = await listSourceRoles(apiKey, id)
    for (const role of roles) {
      if (role.scope === "subscription") continue
      const name = role.name?.trim()
      if (!name) continue
      const removed = await ludusRequest("/ansible/role", {
        method: "POST",
        apiKey,
        body: { role: name, action: "remove", global: true },
      })
      if (removed.error && removed.status !== 404 && removed.status !== 409) {
        warnings.push(`Role ${name}: ${removed.error}`)
      }
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : "Could not list source roles")
  }

  try {
    const collections = await listSourceCollections(apiKey, id)
    for (const collection of collections) {
      if (collection.scope === "subscription") continue
      const name = (collection.fqcn || collection.name || "").trim()
      if (!name) continue
      const removed = await ludusRequest("/ansible/collection", {
        method: "POST",
        apiKey,
        body: { collection: name, action: "remove", global: true },
      })
      if (removed.error && removed.status !== 404 && removed.status !== 409) {
        warnings.push(`Collection ${name}: ${removed.error}`)
      }
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : "Could not list source collections")
  }

  return warnings
}
