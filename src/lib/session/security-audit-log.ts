import type { NextRequest } from "next/server"
import { writeAppLog } from "@/lib/logs/app-log"

export type AuditEvent = "login" | "logout" | "rate_limit"

export type AuditOutcome = "success" | "failure" | "blocked"

/** Client IP recorded by nginx. The first X-Forwarded-For value is client-controlled. */
export function clientIpFromRequest(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  return "unknown"
}

export function logSecurityAudit(
  event: AuditEvent,
  outcome: AuditOutcome,
  details: { user?: string; ip?: string; reason?: string } = {},
): void {
  writeAppLog({
    category: "auth",
    event,
    outcome,
    username: details.user ?? null,
    ip: details.ip ?? null,
    detail: details.reason ?? null,
    level: outcome === "failure" || outcome === "blocked" ? "warn" : "info",
  })
}
