import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session/session-edge"
import { clearSessionWithCredentials } from "@/lib/session/session-node"
import { clientIpFromRequest, logSecurityAudit } from "@/lib/session/security-audit-log"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  const ip = clientIpFromRequest(request)
  if (session) {
    logSecurityAudit("logout", "success", { user: session.username, ip })
  }
  const response = NextResponse.json({ success: true })
  clearSessionWithCredentials(response, session?.sessionId)
  return response
}
