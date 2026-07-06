import { NextRequest, NextResponse } from "next/server"

import { authenticateUser, saveApiKeyToBashrc } from "@/lib/auth-ssh"

import { establishSession } from "@/lib/session"

import { checkLudusUser } from "@/lib/login-ludus-check"

import {

  consumeLoginContinuation,

  createLoginContinuation,

} from "@/lib/login-continuation-store"

import { checkRateLimit } from "@/lib/rate-limit"

import { clientIpFromRequest, logSecurityAudit } from "@/lib/security-audit-log"

import { safeClientError } from "@/lib/safe-client-error"



const LOGIN_RATE_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? "10")

const LOGIN_RATE_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? String(60 * 1000))



async function finishLogin(
  response: NextResponse,
  args: { username: string; apiKey: string; isAdmin: boolean; sshPassword: string },
  ip: string,
): Promise<NextResponse> {
  logSecurityAudit("login", "success", { user: args.username, ip })
  if (args.isAdmin && args.apiKey.trim()) {
    const { rememberBlueprintOperator } = await import("@/lib/blueprint-global-install")
    await rememberBlueprintOperator(args.apiKey.trim()).catch((err) => {
      console.warn("rememberBlueprintOperator failed:", err instanceof Error ? err.message : err)
    })
  }
  await establishSession(response, args)
  return response
}



function loginOverInsecureTransport(request: NextRequest): boolean {

  if (process.env.NODE_ENV !== "production") return false

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()

  if (proto === "https") return false

  if (process.env.DISABLE_HTTPS === "true" && process.env.TRUST_PROXY_TLS !== "true") {

    return true

  }

  return proto !== "https" && request.nextUrl.protocol === "http:"

}



export async function POST(request: NextRequest) {

  const ip = clientIpFromRequest(request)

  const rate = checkRateLimit(`login:${ip}`, LOGIN_RATE_MAX, LOGIN_RATE_WINDOW_MS)

  if (!rate.allowed) {

    logSecurityAudit("rate_limit", "blocked", { ip, reason: "login" })

    return NextResponse.json(

      { error: "Too many login attempts. Please try again later." },

      {

        status: 429,

        headers: rate.retryAfterSec ? { "Retry-After": String(rate.retryAfterSec) } : undefined,

      },

    )

  }



  if (loginOverInsecureTransport(request)) {

    return NextResponse.json(

      { error: "Login must use HTTPS. Open the app on port 443, not plain HTTP." },

      { status: 400 },

    )

  }



  const body = await request.json().catch(() => null)

  const {

    username: bodyUsername,

    password: bodyPassword,

    apiKey: manualApiKey,

    continuationToken,

  } = body || {}



  let username = typeof bodyUsername === "string" ? bodyUsername.trim() : ""

  let password = typeof bodyPassword === "string" ? bodyPassword : ""



  if (continuationToken) {

    const pending = consumeLoginContinuation(String(continuationToken))

    if (!pending) {

      return NextResponse.json(

        { error: "Login session expired. Sign in again with your SSH password." },

        { status: 401 },

      )

    }

    username = pending.username

    password = pending.sshPassword

  }



  if (!username || !password) {

    return NextResponse.json({ error: "Username and password are required" }, { status: 400 })

  }



  if (manualApiKey) {

    const saveResult = await saveApiKeyToBashrc(username, password, manualApiKey)

    if (!saveResult.success) {

      logSecurityAudit("login", "failure", { user: username, ip, reason: "api_key_save" })

      return NextResponse.json(

        { error: safeClientError(saveResult.message, "Failed to save API key") },

        { status: 500 },

      )

    }

    const ludusCheck = await checkLudusUser(manualApiKey, username)

    if (!ludusCheck.ok) {

      if (ludusCheck.kind === "unreachable") {

        return NextResponse.json({ error: ludusCheck.message }, { status: 503 })

      }

      logSecurityAudit("login", "failure", { user: username, ip, reason: "invalid_api_key" })

      return NextResponse.json({ error: "API key is invalid — please check it and try again" }, { status: 401 })

    }

    const response = NextResponse.json({ success: true, isAdmin: ludusCheck.isAdmin, username })

    return finishLogin(

      response,

      { username, apiKey: manualApiKey, isAdmin: ludusCheck.isAdmin, sshPassword: password },

      ip,

    )

  }



  const result = await authenticateUser(username, password)



  if (!result.success) {

    if (result.reason === "no_api_key") {

      const token = createLoginContinuation(username, password)

      return NextResponse.json(

        { needsApiKey: true, username, continuationToken: token },

        { status: 200, headers: { "Cache-Control": "no-store" } },

      )

    }

    const status = result.reason === "auth_failed" ? 401 : 503

    if (status === 401) {

      logSecurityAudit("login", "failure", { user: username, ip, reason: "auth_failed" })

    }

    return NextResponse.json(

      {

        error: safeClientError(

          result.message,

          status === 401 ? "Invalid username or password" : "Login service unavailable",

        ),

      },

      { status, headers: { "Cache-Control": "no-store" } },

    )

  }



  const ludusCheck = await checkLudusUser(result.apiKey, username)



  if (!ludusCheck.ok) {

    if (ludusCheck.kind === "unreachable") {

      return NextResponse.json(

        { error: ludusCheck.message },

        { status: 503, headers: { "Cache-Control": "no-store" } },

      )

    }

    if (ludusCheck.kind === "profile_mismatch") {

      return NextResponse.json(

        {

          error:

            "Ludus accepted the API key but the returned user profile did not match your login name. Check LUDUS_URL and username.",

        },

        { status: 503, headers: { "Cache-Control": "no-store" } },

      )

    }

    const token = createLoginContinuation(username, password)

    return NextResponse.json(

      { needsApiKey: true, username, staleKey: true, continuationToken: token },

      { status: 200, headers: { "Cache-Control": "no-store" } },

    )

  }



  const response = NextResponse.json(

    { success: true, isAdmin: ludusCheck.isAdmin, username },

    { headers: { "Cache-Control": "no-store" } },

  )

  return finishLogin(

    response,

    { username, apiKey: result.apiKey, isAdmin: ludusCheck.isAdmin, sshPassword: password },

    ip,

  )

}
