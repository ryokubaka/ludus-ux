import { NextRequest, NextResponse } from "next/server"
import { ludusRequest } from "@/lib/ludus-client"
import { getSessionFromRequest } from "@/lib/session"

async function handler(
  request: NextRequest,
  { params }: { params: { path?: string[] } }
) {
  try {
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

  // When an admin is impersonating another user, use the impersonated user's
  // API key so that Ludus API calls are scoped to the target user.
  // The session cookie (set by /api/auth/impersonate) is the primary source;
  // the X-Impersonate-Apikey request header is a fallback for any in-flight
  // requests that were dispatched before the cookie was written.
  const impersonateApiKey = session.isAdmin
    ? (session.impersonationApiKey || request.headers.get("X-Impersonate-Apikey") || null)
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

  // Group bulk user/range mutations can exceed the default 30s while Ludus updates PocketBase / ACLs.
  const groupBulkPath = /^\/groups\/[^/]+\/(users|ranges)$/
  const slowGroupOp =
    groupBulkPath.test(path) && ["POST", "DELETE"].includes(request.method)

  // Ansible inventory is generated server-side and routinely exceeds 30s on busy ranges.
  const slowAnsibleInventoryGet =
    request.method === "GET" && /\/range\/ansibleinventory\b/i.test(path)

  const result = await ludusRequest(fullPath, {
    method: request.method,
    body,
    apiKey: effectiveApiKey,
    useAdminEndpoint: useAdmin,
    userOverride,
    timeout: slowGroupOp ? 120_000 : slowAnsibleInventoryGet ? 120_000 : 30_000,
  })

  if (result.error) {
    // Annotate connection failures on the admin endpoint with an actionable hint so the
    // user knows why it failed rather than seeing a raw ECONNREFUSED message.
    const isConnectionError = result.status === 0
    const errorMessage =
      useAdmin && isConnectionError
        ? `${result.error} — admin API (port 8081) unreachable. Set LUDUS_ADMIN_URL (or Settings → Admin API URL) to https://<ludus-host>:8081 if that port is reachable from the container, or fix root SSH so the optional tunnel to 127.0.0.1:18081 can work.`
        : result.error
    return NextResponse.json({ error: errorMessage }, { status: result.status || 500 })
  }

  return NextResponse.json(result.data, { status: result.status || 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[proxy] Unexpected error:", message)
    return NextResponse.json({ error: `Internal proxy error: ${message}` }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler

// Allow long-running Ludus calls (e.g. testing/allow does iptables + DNS work on the router VM)
export const maxDuration = 120
