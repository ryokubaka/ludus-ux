import { NextRequest, NextResponse } from "next/server"
import { authenticateUser, saveApiKeyToBashrc } from "@/lib/auth-ssh"
import { setSessionCookie, type SessionData } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIpFromRequest, logSecurityAudit } from "@/lib/security-audit-log"
import { safeClientError } from "@/lib/safe-client-error"

const LOGIN_RATE_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? "10")
const LOGIN_RATE_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? String(60 * 1000))

async function checkLudusUser(apiKey: string, ludusUsername: string): Promise<{ isAdmin: boolean; valid: boolean }> {
  try {
    const result = await ludusRequest<unknown>("/user", { apiKey })
    if (result.error || result.status !== 200) {
      return { isAdmin: false, valid: false }
    }
    const profile = ludusCallerFromGetUser(result.data, ludusUsername)
    if (!profile) return { isAdmin: false, valid: false }
    return { isAdmin: profile.user.isAdmin, valid: true }
  } catch {
    return { isAdmin: false, valid: false }
  }
}

function finishLogin(
  response: NextResponse,
  session: SessionData,
  ip: string,
): Promise<NextResponse> {
  logSecurityAudit("login", "success", { user: session.username, ip })
  return setSessionCookie(response, session).then(() => response)
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

  const body = await request.json().catch(() => null)
  const { username, password, apiKey: manualApiKey } = body || {}

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
    const { isAdmin, valid } = await checkLudusUser(manualApiKey, username)
    if (!valid) {
      logSecurityAudit("login", "failure", { user: username, ip, reason: "invalid_api_key" })
      return NextResponse.json({ error: "API key is invalid — please check it and try again" }, { status: 401 })
    }
    const session: SessionData = {
      username,
      apiKey: manualApiKey,
      isAdmin,
      loginAt: new Date().toISOString(),
      sshPassword: password,
    }
    const response = NextResponse.json({ success: true, isAdmin, username })
    return finishLogin(response, session, ip)
  }

  const result = await authenticateUser(username, password)

  if (!result.success) {
    if (result.reason === "no_api_key") {
      return NextResponse.json({ needsApiKey: true, username }, { status: 200 })
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
      { status },
    )
  }

  const { isAdmin, valid } = await checkLudusUser(result.apiKey, username)

  if (!valid) {
    return NextResponse.json({ needsApiKey: true, username, staleKey: true }, { status: 200 })
  }

  const session: SessionData = {
    username,
    apiKey: result.apiKey,
    isAdmin,
    loginAt: new Date().toISOString(),
    sshPassword: password,
  }
  const response = NextResponse.json({ success: true, isAdmin, username })
  return finishLogin(response, session, ip)
}
