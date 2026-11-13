/**
 * GET  /api/range/builder-layout?rangeId=...  — saved canvas node positions
 * PUT  /api/range/builder-layout               — persist canvas node positions
 *
 * Positions are LUX-local UI state (not range-config.yml). They are scoped to
 * the effective username so an impersonation session keeps its own layout.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin/admin-impersonation-request"
import { requireSession } from "@/lib/session/require-session"
import type { ResolvedSession } from "@/lib/session/session"
import {
  getRangeBuilderLayout,
  saveRangeBuilderLayout,
  type RangeBuilderLayout,
} from "@/lib/range/range-builder-layout-store"

async function effectiveUsername(request: NextRequest, session: ResolvedSession): Promise<string> {
  const imp = await resolveAdminImpersonationFromRequest(session, request)
  if (imp.apiKey) return (imp.sshLogin || imp.ludusPrincipal || session.username).trim()
  return session.username
}

export async function GET(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response

  const rangeId = request.nextUrl.searchParams.get("rangeId")?.trim()
  if (!rangeId) return NextResponse.json({ error: "rangeId query parameter required" }, { status: 400 })

  const layout = getRangeBuilderLayout(rangeId, await effectiveUsername(request, gate.session))
  return NextResponse.json({ layout })
}

export async function PUT(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response

  let body: { rangeId?: unknown; layout?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rangeId = typeof body.rangeId === "string" ? body.rangeId.trim() : ""
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const layout = (body.layout && typeof body.layout === "object" ? body.layout : {}) as RangeBuilderLayout
  saveRangeBuilderLayout(rangeId, await effectiveUsername(request, gate.session), layout)
  return NextResponse.json({ ok: true })
}
