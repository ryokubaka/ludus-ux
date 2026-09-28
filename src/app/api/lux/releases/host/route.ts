import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { probeLuxUpgradeHost } from "@/lib/lux-upgrade-run"

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  const status = await probeLuxUpgradeHost()
  return finishAdminResponse(NextResponse.json(status), admin)
}
