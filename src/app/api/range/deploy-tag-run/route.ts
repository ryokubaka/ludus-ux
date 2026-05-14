/**
 * POST /api/range/deploy-tag-run
 * Body: { rangeId: string, tags: string[], requestedAt?: number }
 * Records a tag-scoped deploy so Deploy History can label rows when Ludus omits `template`.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { getSessionFromRequest } from "@/lib/session"
import { filterLudusDeployTags } from "@/lib/ludus-deploy-tags"
import { insertLuxDeployTagRun, updateLuxDeployTagRunLudusLogId } from "@/lib/range-log-markers-store"
import { correlateLudusLogIdAfterRangeAction } from "@/lib/range-ludus-log-correlate"

function getEffective(
  request: NextRequest,
  session: {
    apiKey: string
    username: string
    isAdmin: boolean
    impersonationApiKey?: string
    impersonationUserId?: string
    impersonationLudusUserId?: string
    impersonationSshLogin?: string
  },
) {
  const imp = resolveAdminImpersonationFromRequest(session, request)
  return {
    effectiveApiKey: imp.apiKey || session.apiKey,
    effectiveUsername:
      imp.apiKey
        ? (imp.sshLogin || imp.ludusPrincipal || session.username).trim()
        : session.username,
    ludusUserOverride: imp.apiKey ? imp.ludusPrincipal ?? undefined : undefined,
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: string; tags?: unknown; requestedAt?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rangeId = typeof body.rangeId === "string" ? body.rangeId.trim() : ""
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const rawTags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : []
  const tags = filterLudusDeployTags(rawTags)
  if (tags.length === 0) {
    return NextResponse.json({ error: "tags must be a non-empty array of known deploy tags" }, { status: 400 })
  }

  const requestedAt =
    typeof body.requestedAt === "number" && Number.isFinite(body.requestedAt)
      ? Math.floor(body.requestedAt)
      : Date.now()

  const { effectiveApiKey, effectiveUsername, ludusUserOverride } = getEffective(request, session)

  const tagsCsv = tags.join(",")
  const runId = insertLuxDeployTagRun({
    rangeId,
    username: effectiveUsername,
    tagsCsv,
    requestedAt,
  })

  void (async () => {
    const ludusLogId = await correlateLudusLogIdAfterRangeAction({
      rangeId,
      apiKey: effectiveApiKey,
      userOverride: ludusUserOverride,
      requestedAtMs: requestedAt,
    })
    if (ludusLogId) updateLuxDeployTagRunLudusLogId(runId, ludusLogId)
  })()

  return NextResponse.json({ id: runId, tags, requestedAt })
}
