/**
 * POST /api/blueprints/delete
 *
 * Deletes one or more Ludus blueprint IDs (handles source IDs with `/` without
 * proxy URL encoding issues). Admins deleting global source blueprints use the
 * stored operator Ludus API key when the session key is not the owner.
 */

import { NextRequest, NextResponse } from "next/server"
import { deleteBlueprintsOnLudus } from "@/lib/blueprint-delete"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { requireSession } from "@/lib/require-session"

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
