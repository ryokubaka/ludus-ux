import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/core/mark-route-dynamic"
import { readLudusUpgradeStatus, startLudusUpgrade } from "@/lib/ludus/ludus-upgrade-run"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"

export async function GET(request: NextRequest) {
  await markRouteDynamic()
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const status = await readLudusUpgradeStatus()
  return finishAdminResponse(NextResponse.json(status), admin)
}

export async function POST(request: NextRequest) {
  await markRouteDynamic()
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  let body: { tag?: unknown }
  try {
    body = (await request.json()) as { tag?: unknown }
  } catch {
    return finishAdminResponse(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }), admin)
  }
  const tag = typeof body.tag === "string" ? body.tag.trim() : ""
  const result = await startLudusUpgrade(tag, admin.session.apiKey)
  if (!result.ok) {
    return finishAdminResponse(
      NextResponse.json({ error: result.error }, { status: result.status }),
      admin,
    )
  }
  return finishAdminResponse(
    NextResponse.json({ started: true, tag: result.tag }, { status: 202 }),
    admin,
  )
}
