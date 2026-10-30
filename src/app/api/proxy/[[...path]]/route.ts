import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin/admin-impersonation-request"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { getProxyLudusTimeoutMs } from "@/lib/lux/proxy-ludus-timeout"
import { resolveSession } from "@/lib/session/session"
import { liveSessionIsAdmin, refreshRevokedAdminCookie } from "@/lib/session/session-admin-check"
import {
  effectiveUsernameFromRequest,
  logLuxUserAction,
  ludusProxyEvent,
} from "@/lib/lux/lux-api-audit"
import { revalidateAfterLudusProxyMutation } from "@/lib/ludus/ludus-proxy-cache-invalidate"
import {
  ensureAnsibleHomeLayoutAsRoot,
  resolveSessionLinuxUser,
} from "@/lib/ansible/ansible-home-repair"
import { formatAnsibleHomeRepairLogLine } from "@/lib/ludus/ludus-ansible-preflight"
import { shouldRepairAnsibleHomeAfterProxyMutation } from "@/lib/ludus/ludus-proxy-ansible-repair"
import { normalizeLudusProxyPath } from "@/lib/ludus/ludus-blueprint-proxy-path"
import { getSettings } from "@/lib/settings/settings-store"
import {
  assertRouterTemplateReady,
} from "@/lib/ludus/ludus-router-template-assert"
import {
  routerTemplateBlockMessage,
} from "@/lib/ludus/ludus-router-template"
import { ensureRangeDeployHostPatches } from "@/lib/range/range-deploy-host-patches"

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

/** Inject Settings `ludusAnsibleVerbose` into POST /range/deploy when client omits `verbose`. */
function applyLudusDeployVerbose(path: string, method: string, body: unknown): unknown {
  if (method !== "POST") return body
  const base = path.split("?")[0]
  if (base !== "/range/deploy") return body
  const verbose = getSettings().ludusAnsibleVerbose
  if (body == null || body === "") {
    return { verbose }
  }
  if (typeof body === "object" && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>
    if (typeof obj.verbose === "boolean") return body
    return { ...obj, verbose }
  }
  return body
}

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { path: pathSegments } = await params
  const segments = pathSegments || []
  const path = normalizeLudusProxyPath(segments)

  const queryString = request.nextUrl.searchParams.toString()
  const fullPath = queryString ? `${path}?${queryString}` : path

  const isAdmin = await liveSessionIsAdmin(session)
  const finish = <T extends NextResponse>(response: T) =>
    refreshRevokedAdminCookie(response, session, isAdmin)

  const useAdmin = request.headers.get("X-Ludus-Admin") === "true"
  if (useAdmin && !isAdmin) {
    return finish(NextResponse.json({ error: "Admin privileges required" }, { status: 403 }))
  }

  const userOverride = isAdmin
    ? request.headers.get("X-Ludus-User") || undefined
    : undefined

  // When an admin is impersonating another user, use the impersonated user's
  // API key so Ludus calls are scoped to that user. Both X-Impersonate-* headers
  // must be present to use the header path — see resolveAdminImpersonationFromRequest.
  const impersonateApiKey = (await resolveAdminImpersonationFromRequest(session, request)).apiKey
  // In Ludus v2, the ROOT API key is only for PocketBase internal operations.
  // All admin API calls (port 8081) use the logged-in admin's own API key.
  // X-Ludus-User (admin fetch-as-user) must use the admin key + X-Impersonate-User,
  // not an active dashboard impersonation vault key.
  const effectiveApiKey =
    userOverride && isAdmin
      ? session.apiKey
      : impersonateApiKey || session.apiKey

  try {
    const rawBody = await parseRequestBody(request)
    const body = applyLudusDeployVerbose(path, request.method, rawBody)

    const linuxUser = await resolveSessionLinuxUser(session, request)
    const basePath = path.split("?")[0]
    if (request.method === "POST" && basePath === "/range/deploy") {
      const router = await assertRouterTemplateReady(effectiveApiKey, {
        userOverride,
      })
      if (!router.ok) {
        return finish(NextResponse.json(
          {
            error: routerTemplateBlockMessage(router),
            code: "router_template_required",
            template: router.template,
            reason: router.reason,
          },
          { status: 409 },
        ))
      }
      const patches = await ensureRangeDeployHostPatches(body, { configText: router.template })
      if (!patches.ok) {
        return finish(NextResponse.json(
          { error: patches.error, code: "deploy_host_patch" },
          { status: 503 },
        ))
      }
    }

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
          // Returned as JSON, never rendered as HTML.
          // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
          ? `${result.error} — admin API refused the connection. A default Ludus install listens on 127.0.0.1:8081 only. Set Settings → Admin API URL to https://127.0.0.1:18081 (LUX forwards that to the server over host SSH). Host SSH must succeed. Use https://<ludus-host>:8081 only after the server accepts connections on that address from this container.`
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
      return finish(NextResponse.json({ error: errorMessage }, { status: result.status || 500 }))
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
      revalidateAfterLudusProxyMutation(request.method, path, session)
      if (linuxUser && shouldRepairAnsibleHomeAfterProxyMutation(request.method, basePath, body)) {
        await ensureAnsibleHomeLayoutAsRoot(linuxUser, { verify: true })
        console.info(formatAnsibleHomeRepairLogLine(linuxUser))
      }
    }

    return finish(NextResponse.json(result.data, { status: result.status || 200 }))
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
    return finish(NextResponse.json({ error: "Internal proxy error" }, { status: 500 }))
  }
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler

// Long Ludus calls — see `getProxyLudusTimeoutMs`.
export const maxDuration = 300
