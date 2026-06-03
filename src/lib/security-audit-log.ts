import type { NextRequest } from "next/server"
import { writeAppLog } from "@/lib/app-log"

export type AuditEvent = "login" | "logout" | "rate_limit"

export type AuditOutcome = "success" | "failure" | "blocked"

/** Client IP from reverse-proxy headers (nginx sets X-Real-IP / X-Forwarded-For). */
export function clientIpFromRequest(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
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
