import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { readUserApiKeyFromBashrc } from "@/lib/user-bashrc-apikey"


/**
 * GET /api/admin/fetch-user-apikey?username=xxx
 *
 * Reads the LUDUS_API_KEY for a user from their ~/.bashrc over root SSH,
 * so admins do not need to manually enter it when impersonating.
 *
 * Admin-only endpoint.
 */
export async function GET(request: NextRequest) {
  await markRouteDynamic()
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  const { searchParams } = new URL(request.url)
  const username = searchParams.get("username")?.trim() ?? ""
  const ludusUserId = searchParams.get("userId")?.trim() ?? ""
  if (!username) {
    return NextResponse.json({ error: "Valid username required" }, { status: 400 })
  }

  const { apiKey, message } = await readUserApiKeyFromBashrc(username, { ludusUserId })
  if (!apiKey) {
    return NextResponse.json({ apiKey: null, message: message ?? "Key not found in ~/.bashrc" })
  }

  const response = NextResponse.json({ apiKey })
  response.headers.set("Cache-Control", "no-store, private")
  return finishAdminResponse(response, admin)
}
