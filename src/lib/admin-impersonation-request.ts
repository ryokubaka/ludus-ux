import type { NextRequest } from "next/server"
import type { SessionData } from "@/lib/session"

type SessionImpersonationPick = Pick<SessionData, "isAdmin" | "impersonationApiKey" | "impersonationUserId">

/**
 * Resolve admin impersonation credentials for a server request.
 *
 * Both X-Impersonate-As AND X-Impersonate-Apikey must be present to use the
 * header path — a partial set falls back to the session cookie so a stale or
 * missing header never silently pairs a new key with the wrong username (or
 * vice versa). When both headers are present they take priority over the cookie
 * because the tab's sessionStorage updates immediately on user switch while the
 * cookie from POST /api/auth/impersonate can still hold the previous impersonated
 * user for one round-trip.
 */
export function resolveAdminImpersonationFromRequest(
  session: SessionImpersonationPick,
  request: NextRequest,
): { apiKey: string | null; userId: string | null } {
  if (!session.isAdmin) return { apiKey: null, userId: null }
  const hKey = request.headers.get("X-Impersonate-Apikey")
  const hAs = request.headers.get("X-Impersonate-As")
  const cKey = session.impersonationApiKey ?? null
  const cAs = session.impersonationUserId ?? null
  // Require both headers together; fall back to cookie when only one is present.
  if (hKey && hAs) return { apiKey: hKey, userId: hAs }
  return { apiKey: cKey, userId: cAs }
}
