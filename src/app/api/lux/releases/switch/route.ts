import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { startLuxUpgrade } from "@/lib/lux-upgrade-run"

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  let body: { tag?: unknown; acknowledgeVersionManagementLoss?: unknown }
  try {
    body = (await request.json()) as { tag?: unknown; acknowledgeVersionManagementLoss?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const tag = typeof body.tag === "string" ? body.tag.trim() : ""
  const acknowledge = body.acknowledgeVersionManagementLoss === true
  const result = await startLuxUpgrade(tag, acknowledge)
  if (!result.ok) {
    logLuxRouteAction(request, admin.session, {
      outcome: "failure",
      detail: `${tag || "(missing)"}: ${result.error}`,
    })
    return finishAdminResponse(
      NextResponse.json({ error: result.error }, { status: result.status }),
      admin,
    )
  }

  logLuxRouteAction(request, admin.session, { detail: result.tag })
  return finishAdminResponse(
    NextResponse.json({ started: true, tag: result.tag }, { status: 202 }),
    admin,
  )
}
