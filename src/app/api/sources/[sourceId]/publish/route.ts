import { NextRequest, NextResponse } from "next/server"
import {
  finalizeGlobalSourceBlueprintInstall,
  rememberBlueprintOperator,
} from "@/lib/blueprint-global-install"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { blueprintInstalledFromSource, normalizeBlueprintList } from "@/lib/blueprint-list-normalize"
import { ludusRequest } from "@/lib/ludus-client"
import { revalidateAfterSourceMutation } from "@/lib/ludus-cache-revalidate"
import { syncSource } from "@/lib/ludus-source-client"
import { setSourcePublished } from "@/lib/source-publication"
import { removeSourceInstalledItems } from "@/lib/source-unpublish"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"

export const maxDuration = 300

/**
 * Admin marks a source available to every LUX user.
 * Ludus still lists sources per user, so LUX shows the admin's catalog to others.
 * Roles and collections are installed instance-wide (`--global`).
 * Blueprints already installed from this source are shared with every user.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { session, apiKey } = await requireSourcesSession(request)
  if (!session || !apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const { sourceId } = await params
  const id = sourceId?.trim()
  if (!id) return NextResponse.json({ error: "sourceId is required" }, { status: 400 })

  let published = false
  try {
    const body = await request.json()
    published = body?.published === true
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const adminKey = session.apiKey?.trim() || apiKey
  const warnings: string[] = []

  if (!published) {
    warnings.push(...(await removeSourceInstalledItems(adminKey, id)))
    setSourcePublished(id, false)
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateAfterSourceMutation(scopeTag)
    logLuxRouteAction(request, session, {
      outcome: "success",
      detail: `publish-source=${id} published=false`,
    })
    return NextResponse.json({ published: false, warnings })
  }

  setSourcePublished(id, true)
  await rememberBlueprintOperator(adminKey)
  if (published) {
    try {
      await syncSource(adminKey, id, { globalRoles: true })
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : "Could not install roles and collections for all users")
    }

    const listed = await ludusRequest<unknown>("/blueprints", { apiKey: adminKey })
    if (!listed.error && listed.data) {
      const rows = normalizeBlueprintList(listed.data).filter((bp) =>
        blueprintInstalledFromSource(id, bp),
      )
      for (const bp of rows) {
        const blueprintId = (bp.id || bp.blueprintID || "").trim()
        if (!blueprintId) continue
        warnings.push(...(await finalizeGlobalSourceBlueprintInstall(adminKey, blueprintId, bp.ownerID)))
      }
    }
  }

  const scopeTag = effectiveScopeTagFromSession(session)
  revalidateAfterSourceMutation(scopeTag)
  logLuxRouteAction(request, session, {
    outcome: warnings.length > 0 ? "failure" : "success",
    detail: `publish-source=${id} published=${published}`,
  })
  return NextResponse.json({ published, warnings })
}
