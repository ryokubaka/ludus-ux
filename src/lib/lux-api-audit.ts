/**
 * Log user-facing API actions to the LUX application log store.
 */

import type { NextRequest } from "next/server"
import { logAppEvent, type LogOutcome } from "@/lib/app-log"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { clientIpFromRequest } from "@/lib/security-audit-log"

const SKIP_LOG_PATH_PREFIXES = [
  "/api/admin/app-logs",
  "/api/logs/stream",
  "/api/goad/tasks/events",
  "/api/health",
  "/api/auth/session",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/debug-agent-log",
]

type SessionLike = {
  username: string
  apiKey?: string
  isAdmin: boolean
  impersonationApiKey?: string
  impersonationUserId?: string
  impersonationLudusUserId?: string
  impersonationSshLogin?: string
}

export function effectiveUsernameFromRequest(
  request: NextRequest,
  session: SessionLike,
): string {
  const imp = resolveAdminImpersonationFromRequest(session, request)
  if (imp.apiKey) {
    return (imp.sshLogin || imp.ludusPrincipal || session.username).trim()
  }
  return session.username
}

export function shouldSkipLuxApiLog(pathname: string): boolean {
  if (SKIP_LOG_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return true
  // Task log SSE streams — not user actions.
  if (/^\/api\/goad\/tasks\/[^/]+\/stream/.test(pathname)) return true
  return false
}

export function ludusProxyEvent(method: string, ludusPath: string): string {
  const slug =
    ludusPath
      .split("?")[0]
      .replace(/^\//, "")
      .replace(/\//g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "") || "root"
  return `ludus_${slug}_${method.toLowerCase()}`
}

export function luxRouteEvent(pathname: string, method: string): string {
  const slug =
    pathname
      .replace(/^\/api\//, "")
      .replace(/\//g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "") || "root"
  return `lux_${slug}_${method.toLowerCase()}`
}

export function logLuxUserAction(
  request: NextRequest,
  username: string,
  event: string,
  detail?: string,
  outcome: LogOutcome = "success",
): void {
  logAppEvent(event, detail ?? `${request.method} ${request.nextUrl.pathname}`, {
    username,
    ip: clientIpFromRequest(request),
    outcome,
    level: outcome === "failure" || outcome === "blocked" ? "warn" : "info",
  })
}

/** Log a LUX route handler action (skips noisy/stream endpoints). */
export function logLuxRouteAction(
  request: NextRequest,
  session: SessionLike,
  opts?: { event?: string; detail?: string; outcome?: LogOutcome },
): void {
  const pathname = request.nextUrl.pathname
  if (shouldSkipLuxApiLog(pathname)) return
  const username = effectiveUsernameFromRequest(request, session)
  const event = opts?.event ?? luxRouteEvent(pathname, request.method)
  logLuxUserAction(request, username, event, opts?.detail, opts?.outcome ?? "success")
}
