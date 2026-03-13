import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"

export const dynamic = "force-dynamic"

/**
 * POST /api/range/create
 *
 * Creates a new Ludus range. This endpoint proxies to the Ludus admin API
 * (port 8081) which is required because range creation needs root-level
 * operations (creating vmbr interfaces, Proxmox pools, etc.).
 *
 * Any authenticated user can create a range — Ludus itself handles authorization.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.rangeID || !body?.name) {
    return NextResponse.json({ error: "rangeID and name are required" }, { status: 400 })
  }

  const settings = getSettings()
  const adminBase = (settings.ludusAdminUrl || settings.ludusUrl.replace(/:8080\b/, ":8081")).replace(/\/$/, "")
  const url = `${adminBase}/api/v2/ranges/create`

  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": effectiveApiKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || data?.result || `HTTP ${res.status}` },
        { status: res.status }
      )
    }
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json(
      { error: `Connection failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }
}
