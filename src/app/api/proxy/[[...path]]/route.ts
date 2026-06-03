import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { ludusRequest } from "@/lib/ludus-client"
import { getProxyLudusTimeoutMs } from "@/lib/proxy-ludus-timeout"
import { getSessionFromRequest } from "@/lib/session"
import {
  effectiveUsernameFromRequest,
  logLuxUserAction,
  ludusProxyEvent,
} from "@/lib/lux-api-audit"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** Parse the request body for mutating methods; returns undefined for GET/HEAD. */
async function parseRequestBody(request: NextRequest): Promise<unknown> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return undefined
  const contentType = request.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    return request.json().catch(() => undefined)
  }
  return request.text().catch(() => undefined)
}

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { path: pathSegments } = await params
  // Build the Ludus API path. Optional catch-all: path may be undefined (root /).
  const segments = pathSegments || []
  const path = segments.length > 0 ? "/" + segments.join("/") : "/"

  const queryString = request.nextUrl.searchParams.toString()
  const fullPath = queryString ? `${path}?${queryString}` : path

  const useAdmin = request.headers.get("X-Ludus-Admin") === "true"
  if (useAdmin && !session.isAdmin) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 403 })
  }

  const userOverride = session.isAdmin
    ? request.headers.get("X-Ludus-User") || undefined
    : undefined

  // When an admin is impersonating another user, use the impersonated user's
  // API key so Ludus calls are scoped to that user. Both X-Impersonate-* headers
  // must be present to use the header path — see resolveAdminImpersonationFromRequest.
  const impersonateApiKey = resolveAdminImpersonationFromRequest(session, request).apiKey
  // In Ludus v2, the ROOT API key is only for PocketBase internal operations.
  // All admin API calls (port 8081) use the logged-in admin's own API key.
  const effectiveApiKey = impersonateApiKey || session.apiKey

  try {
    const body = await parseRequestBody(request)

    const result = await ludusRequest(fullPath, {
      method: request.method,
      body,
      apiKey: effectiveApiKey,
      useAdminEndpoint: useAdmin,
      userOverride,
      timeout: getProxyLudusTimeoutMs(path, request.method),
    })

    if (result.error) {
      // Annotate connection failures on the admin endpoint with an actionable hint so the
      // user knows why it failed rather than seeing a raw ECONNREFUSED message.
      const isConnectionError = result.status === 0
      const errorMessage =
        useAdmin && isConnectionError
          ? `${result.error} — admin API (port 8081) unreachable. Set LUDUS_ADMIN_URL (or Settings → Admin API URL) to https://<ludus-host>:8081 if that port is reachable from the container, or fix root SSH so the optional tunnel to 127.0.0.1:18081 can work.`
          : result.error
      if (MUTATING_METHODS.has(request.method)) {
        const username = effectiveUsernameFromRequest(request, session)
        const detailParts = [`${request.method} ${fullPath}`]
        if (useAdmin) detailParts.push("admin=1")
        if (userOverride) detailParts.push(`as=${userOverride}`)
        detailParts.push(String(errorMessage).slice(0, 160))
        logLuxUserAction(
          request,
          username,
          ludusProxyEvent(request.method, path),
          detailParts.join(" "),
          "failure",
        )
      }
      return NextResponse.json({ error: errorMessage }, { status: result.status || 500 })
    }

    if (MUTATING_METHODS.has(request.method)) {
      const username = effectiveUsernameFromRequest(request, session)
      const detailParts = [`${request.method} ${fullPath}`]
      if (useAdmin) detailParts.push("admin=1")
      if (userOverride) detailParts.push(`as=${userOverride}`)
      logLuxUserAction(
        request,
        username,
        ludusProxyEvent(request.method, path),
        detailParts.join(" "),
        "success",
      )
    }

    return NextResponse.json(result.data, { status: result.status || 200 })
  } catch (err) {
    // Log full details server-side only; don't leak exception messages to the client.
    console.error("[proxy] Unexpected error:", err instanceof Error ? err.message : String(err))
    if (MUTATING_METHODS.has(request.method)) {
      const username = effectiveUsernameFromRequest(request, session)
      logLuxUserAction(
        request,
        username,
        ludusProxyEvent(request.method, path),
        `${request.method} ${fullPath} internal error`,
        "failure",
      )
    }
    return NextResponse.json({ error: "Internal proxy error" }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler

// Long Ludus calls — see `getProxyLudusTimeoutMs`.
export const maxDuration = 300
