import { NextRequest, NextResponse } from "next/server"
import { decryptCookiePayload, readCookieToken } from "@/lib/session-edge"
import { layoutSessionFromPayload } from "@/lib/session-layout"
import { clearSessionWithCredentials } from "@/lib/session-node"

/**
 * Clear a cookie whose vault row is already gone, then send the browser to login.
 * This is a GET another site can trigger, so a live session is left alone and
 * sent home instead.
 */
export async function GET(request: NextRequest) {
  const token = await readCookieToken(request)
  const payload = token ? await decryptCookiePayload(token) : null
  if (payload && !layoutSessionFromPayload(payload).revoked) {
    return NextResponse.redirect(new URL("/", request.url))
  }
  const response = NextResponse.redirect(new URL("/login", request.url))
  clearSessionWithCredentials(response, payload?.sessionId)
  return response
}
