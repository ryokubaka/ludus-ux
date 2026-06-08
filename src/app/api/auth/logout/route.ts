import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session-edge"
import { clearSessionWithCredentials } from "@/lib/session-node"
import { clientIpFromRequest, logSecurityAudit } from "@/lib/security-audit-log"

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
