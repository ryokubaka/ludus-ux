import { NextRequest, NextResponse } from "next/server"
import { shareBlueprintOnLudus } from "@/lib/blueprint-share"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { resolveSession } from "@/lib/session"

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { blueprintId?: string; userIDs?: string[]; groupNames?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const blueprintId = body.blueprintId?.trim()
  if (!blueprintId) {
    return NextResponse.json({ error: "blueprintId is required" }, { status: 400 })
  }

  const userIDs = Array.isArray(body.userIDs)
    ? body.userIDs.map((id) => String(id).trim()).filter(Boolean)
    : []
  const groupNames = Array.isArray(body.groupNames)
    ? body.groupNames.map((name) => String(name).trim()).filter(Boolean)
    : []

  if (userIDs.length === 0 && groupNames.length === 0) {
    return NextResponse.json({ error: "Select at least one user or group" }, { status: 400 })
  }

  const outcome = await shareBlueprintOnLudus(session, request, blueprintId, userIDs, groupNames)

  if (outcome.httpError && outcome.success.length === 0 && outcome.errors.length === 0) {
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `share-blueprint=${blueprintId}`,
    })
    return NextResponse.json(
      { error: outcome.httpError, status: outcome.status },
      { status: outcome.status === 403 ? 403 : outcome.status || 500 },
    )
  }

  const scopeTag = effectiveScopeTagFromSession(session)
  revalidateLudusResource("blueprints")
  revalidateLudusScopeResource(scopeTag, "blueprints")

  const ok = outcome.success.length > 0 || (outcome.errors.length === 0 && !outcome.httpError)
  logLuxRouteAction(request, session, {
    outcome: ok ? "success" : "failure",
    detail: `share-blueprint=${blueprintId}`,
  })

  return NextResponse.json({
    ok,
    success: outcome.success,
    errors: outcome.errors,
    userShare: outcome.userShare,
    groupShare: outcome.groupShare,
    httpError: outcome.httpError,
  })
}
