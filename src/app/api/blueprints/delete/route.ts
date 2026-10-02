/**
 * POST /api/blueprints/delete
 *
 * Deletes one or more Ludus blueprint IDs (handles source IDs with `/` without
 * proxy URL encoding issues). Admins deleting global source blueprints use the
 * stored operator Ludus API key when the session key is not the owner.
 */

import { NextRequest, NextResponse } from "next/server"
import { deleteBlueprintsOnLudus } from "@/lib/blueprint-delete"
import { normalizeBlueprintList } from "@/lib/blueprint-list-normalize"
import { ludusRequest } from "@/lib/ludus-client"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { requireSession } from "@/lib/require-session"
import { canDeleteBlueprint } from "@/lib/blueprint-delete-authz"

export async function POST(request: NextRequest) {
  const auth = await requireSession(request)
  if (!auth.ok) return auth.response
  const { session } = auth

  let body: { blueprintId?: string; aliasIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const blueprintId = body.blueprintId?.trim()
  if (!blueprintId) {
    return NextResponse.json({ error: "blueprintId is required" }, { status: 400 })
  }

  const aliasIds = Array.isArray(body.aliasIds)
    ? body.aliasIds.map((id) => String(id).trim()).filter(Boolean)
    : []

  const viewerKey =
    resolveAdminImpersonationFromRequest(session, request).apiKey || session.apiKey
  const ownedIds = new Set<string>()
  if (!session.isAdmin) {
    const listed = await ludusRequest<unknown>("/blueprints", { apiKey: viewerKey })
    if (!listed.error && listed.data) {
      for (const bp of normalizeBlueprintList(listed.data)) {
        if (bp.access !== "owner") continue
        const id = (bp.id || bp.blueprintID || "").trim()
        if (id) ownedIds.add(id)
      }
    }
  }
  const owns = (id: string) => session.isAdmin || ownedIds.has(id)

  // Shared source blueprints stay unless the caller owns them or is an admin.
  if (
    !canDeleteBlueprint(session, blueprintId, { owns: owns(blueprintId) }) ||
    aliasIds.some((id) => !canDeleteBlueprint(session, id, { owns: owns(id) }))
  ) {
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `delete-blueprint-denied=${blueprintId}`,
    })
    return NextResponse.json(
      { error: "Only the blueprint owner or an admin can delete this blueprint" },
      { status: 403 },
    )
  }

  const { attempts, anyOk } = await deleteBlueprintsOnLudus(session, request, blueprintId, aliasIds)

  if (anyOk) {
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateLudusResource("blueprints")
    revalidateLudusScopeResource(scopeTag, "blueprints")
    logLuxRouteAction(request, session, {
      outcome: "success",
      detail: `delete-blueprint=${blueprintId}`,
    })
    return NextResponse.json({
      ok: true,
      attempts,
      message: "Blueprint deleted",
    })
  }

  const primary = attempts.find((a) => a.blueprintId === blueprintId) ?? attempts[0]
  logLuxRouteAction(request, session, {
    outcome: "failure",
    detail: `delete-blueprint=${blueprintId}`,
  })
  return NextResponse.json(
    {
      error: primary?.error || "Blueprint delete failed",
      status: primary?.status || 404,
      attempts,
    },
    { status: primary?.status === 403 ? 403 : primary?.status || 404 },
  )
}
