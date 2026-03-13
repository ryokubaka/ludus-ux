import { NextRequest, NextResponse } from "next/server"
import { ludusRequest } from "@/lib/ludus-client"
import { getSessionFromRequest } from "@/lib/session"

async function handler(
  request: NextRequest,
  { params }: { params: { path?: string[] } }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Build the Ludus API path. Optional catch-all: params.path may be undefined (root /).
  const segments = params.path || []
  const path = segments.length > 0 ? "/" + segments.join("/") : "/"

  const searchParams = request.nextUrl.searchParams
  const queryString = searchParams.toString()
  const fullPath = queryString ? `${path}?${queryString}` : path

  const useAdmin = request.headers.get("X-Ludus-Admin") === "true"
  if (useAdmin && !session.isAdmin) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 403 })
  }

  const userOverride = session.isAdmin
    ? request.headers.get("X-Ludus-User") || undefined
    : undefined

  // When an admin is impersonating another user, their client sends the
  // impersonated user's API key via X-Impersonate-Apikey so that Ludus API
  // calls (range config, templates, etc.) are scoped to the target user.
  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  // In Ludus v2, the ROOT API key is only for PocketBase internal operations.
  // All admin API calls (port 8081) use the logged-in admin's own API key.
  const effectiveApiKey = impersonateApiKey || session.apiKey

  let body: unknown
  const contentType = request.headers.get("content-type") || ""
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => undefined)
    } else {
      body = await request.text().catch(() => undefined)
    }
  }

  const result = await ludusRequest(fullPath, {
    method: request.method,
    body,
    apiKey: effectiveApiKey,
    useAdminEndpoint: useAdmin,
    userOverride,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }

  return NextResponse.json(result.data, { status: result.status || 200 })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler

// Allow long-running Ludus calls (e.g. testing/allow does iptables + DNS work on the router VM)
export const maxDuration = 120
