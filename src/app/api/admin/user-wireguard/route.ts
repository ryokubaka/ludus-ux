import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { ludusRequest } from "@/lib/ludus-client"
import { readUserApiKeyFromBashrc } from "@/lib/user-bashrc-apikey"


/**
 * GET /api/admin/user-wireguard?username=xxx
 *
 * Ludus GET /user/wireguard is scoped to the caller's API key — X-Impersonate-User
 * does not change the config. Admins download another user's config by reading their
 * LUDUS_API_KEY from ~/.bashrc (same path as impersonation) and calling Ludus as them.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  const username = request.nextUrl.searchParams.get("username")?.trim()
  if (!username) {
    return NextResponse.json({ error: "username query param required" }, { status: 400 })
  }

  const { apiKey, message } = await readUserApiKeyFromBashrc(username)
  if (!apiKey) {
    return NextResponse.json(
      { error: message ?? "Could not read user API key from ~/.bashrc" },
      { status: 404 },
    )
  }

  const result = await ludusRequest<{ result?: { wireGuardConfig?: string } }>("/user/wireguard", {
    apiKey,
  })
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }

  return finishAdminResponse(NextResponse.json(result.data ?? {}), admin)
}
