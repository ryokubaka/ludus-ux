import "server-only"

import { NextRequest } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin/admin-impersonation-request"
import { resolveSession } from "@/lib/session/session"

export async function resolveSourcesApiKey(request: NextRequest): Promise<string | null> {
  const session = await resolveSession(request)
  if (!session) return null
  const { apiKey } = await resolveAdminImpersonationFromRequest(session, request)
  return apiKey || session.apiKey
}

export async function requireSourcesSession(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return { session: null as null, apiKey: null as null }
  const { apiKey: impersonateApiKey } = await resolveAdminImpersonationFromRequest(session, request)
  return { session, apiKey: impersonateApiKey || session.apiKey }
}
