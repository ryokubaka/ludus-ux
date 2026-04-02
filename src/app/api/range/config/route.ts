import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * GET  /api/range/config?rangeID=...  — fetch current config YAML
 * PUT  /api/range/config              — upload config YAML (converts to multipart for Ludus)
 *
 * The Ludus PUT /range/config endpoint expects multipart/form-data with a "file" field,
 * so this route accepts JSON { config, rangeId?, force? } and re-packages it.
 */

function buildLudusUrl(path: string, useAdmin: boolean): string {
  const settings = getSettings()
  let baseUrl = settings.ludusUrl
  if (useAdmin) {
    baseUrl = settings.ludusAdminUrl || settings.ludusUrl.replace(/:8080\b/, ":8081")
  }
  const cleanBase = baseUrl.replace(/\/$/, "")
  const apiPath = path.startsWith("/api/v2") ? path : `/api/v2${path}`
  return `${cleanBase}${apiPath}`
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const rangeId = request.nextUrl.searchParams.get("rangeID")
  const ludusPath = rangeId ? `/range/config?rangeID=${encodeURIComponent(rangeId)}` : "/range/config"

  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  try {
    const res = await fetch(buildLudusUrl(ludusPath, false), {
      method: "GET",
      headers: {
        "X-API-KEY": effectiveApiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return NextResponse.json({ error: data?.error || `HTTP ${res.status}` }, { status: res.status })
    }
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.config) {
    return NextResponse.json({ error: "Missing 'config' in request body" }, { status: 400 })
  }

  const { config, rangeId, force } = body as { config: string; rangeId?: string; force?: boolean }
  const ludusPath = rangeId ? `/range/config?rangeID=${encodeURIComponent(rangeId)}` : "/range/config"

  // Prefer the session-cookie impersonation key (survives page refresh) then fall back
  // to the request header (set by client-side sessionStorage, present during the same session).
  const impersonateApiKey = session.isAdmin
    ? (session.impersonationApiKey || request.headers.get("X-Impersonate-Apikey") || null)
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const formData = new FormData()
  const blob = new Blob([config], { type: "application/x-yaml" })
  formData.append("file", blob, "range-config.yml")
  if (force) formData.append("force", "true")

  try {
    const res = await fetch(buildLudusUrl(ludusPath, false), {
      method: "PUT",
      headers: {
        "X-API-KEY": effectiveApiKey,
      },
      body: formData,
      cache: "no-store",
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return NextResponse.json({ error: data?.error || `HTTP ${res.status}` }, { status: res.status })
    }
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
