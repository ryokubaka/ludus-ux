import type { NextRequest } from "next/server"
import type { SessionData } from "@/lib/session"

type SessionImpersonationPick = Pick<SessionData, "isAdmin" | "impersonationApiKey" | "impersonationUserId">

/**
 * Resolve admin impersonation credentials for a server request.
 *
 * Prefer `X-Impersonate-As` + `X-Impersonate-Apikey` when both are present: the
 * tab's sessionStorage updates immediately on user switch, while the session
 * cookie from `POST /api/auth/impersonate` can still hold the *previous*
 * impersonated user until that request finishes.
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
  if (hKey && hAs) return { apiKey: hKey, userId: hAs }
  if (hKey || hAs) return { apiKey: hKey || cKey, userId: hAs || cAs }
  return { apiKey: cKey, userId: cAs }
}
