import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { readUserApiKeyFromBashrc } from "@/lib/user-bashrc-apikey"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/fetch-user-apikey?username=xxx
 *
 * Reads the LUDUS_API_KEY for a user from their ~/.bashrc over root SSH,
 * so admins do not need to manually enter it when impersonating.
 *
 * Admin-only endpoint.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  const { searchParams } = new URL(request.url)
  const username = searchParams.get("username")?.trim() ?? ""
  if (!username) {
    return NextResponse.json({ error: "Valid username required" }, { status: 400 })
  }

  const { apiKey, message } = await readUserApiKeyFromBashrc(username)
  if (!apiKey) {
    return NextResponse.json({ apiKey: null, message: message ?? "Key not found in ~/.bashrc" })
  }

  return finishAdminResponse(NextResponse.json({ apiKey }), admin)
}
