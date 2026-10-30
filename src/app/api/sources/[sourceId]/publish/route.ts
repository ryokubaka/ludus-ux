import { NextRequest, NextResponse } from "next/server"
import {
  finalizeGlobalSourceBlueprintInstall,
  rememberBlueprintOperator,
} from "@/lib/blueprints/blueprint-global-install"
import { effectiveScopeTagFromSession } from "@/lib/session/effective-scope"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"
import { blueprintInstalledFromSource, normalizeBlueprintList } from "@/lib/blueprints/blueprint-list-normalize"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { revalidateAfterSourceMutation } from "@/lib/ludus/ludus-cache-revalidate"
import { syncSource } from "@/lib/sources/ludus-source-client"
import { setSourcePublished } from "@/lib/sources/source-publication"
import { removeSourceInstalledItems } from "@/lib/sources/source-unpublish"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"

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
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const { session } = admin
  const apiKey = session.apiKey

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
    return finishAdminResponse(NextResponse.json({ published: false, warnings }), admin)
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
  return finishAdminResponse(NextResponse.json({ published, warnings }), admin)
}
