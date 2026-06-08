/**
 * /api/auth/impersonate
 *
 * Manages impersonation state: metadata in the slim session cookie,
 * target API key in the server-side credential vault.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  clearSessionImpersonation,
  resolveSession,
  updateSessionImpersonation,
} from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { clientIpFromRequest } from "@/lib/security-audit-log"
import { logAppEvent } from "@/lib/app-log"

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const impersonating = !!(
    session.impersonationUserId?.trim() && session.impersonationApiKey?.trim()
  )
  return NextResponse.json({
    impersonating,
    username: impersonating ? session.impersonationUserId! : null,
    ludusUserId: impersonating ? session.impersonationLudusUserId ?? null : null,
    sshLogin: impersonating ? session.impersonationSshLogin ?? null : null,
  })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const { session } = admin

  let body: {
    apiKey?: string
    ludusPrincipal?: string
    ludusUserId?: string
    sshLogin?: string
    username?: string
  }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  if (!body.apiKey) {
    return NextResponse.json({ error: "apiKey required" }, { status: 400 })
  }

  const ludusPrincipal = (body.ludusPrincipal ?? body.username)?.trim() || ""
  if (!ludusPrincipal) {
    return NextResponse.json(
      { error: "ludusPrincipal or username required" },
      { status: 400 },
    )
  }

  const ludusUserId = (body.ludusUserId ?? body.username)?.trim() || ludusPrincipal
  const sshLogin = (body.sshLogin ?? body.username)?.trim() || ludusPrincipal

  const ludusResult = await ludusRequest<unknown>("/user", { apiKey: body.apiKey })
  if (ludusResult.error || ludusResult.status !== 200) {
    logAppEvent("impersonate_start", "Invalid apiKey for impersonation", {
      username: session.username,
      ip: clientIpFromRequest(request),
      outcome: "failure",
    })
    return NextResponse.json({ error: "API key is invalid" }, { status: 400 })
  }
  const profile = ludusCallerFromGetUser(ludusResult.data, ludusPrincipal)
  if (!profile) {
    return NextResponse.json({ error: "Could not resolve Ludus user for apiKey" }, { status: 400 })
  }
  const fields = profile.user
  const resolvedPrincipal = (fields.name ?? "").trim() || fields.userID
  const resolvedSsh = (fields.proxmoxUsername ?? "").trim() || sshLogin
  if (
    resolvedPrincipal.toLowerCase() !== ludusPrincipal.toLowerCase() &&
    (fields.userID ?? "").trim().toLowerCase() !== ludusPrincipal.toLowerCase()
  ) {
    logAppEvent("impersonate_start", "apiKey does not match ludusPrincipal", {
      username: session.username,
      ip: clientIpFromRequest(request),
      outcome: "failure",
    })
    return NextResponse.json({ error: "API key does not match the selected user" }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  try {
    await updateSessionImpersonation(response, session, {
      impersonationApiKey: body.apiKey,
      impersonationUserId: ludusPrincipal,
      impersonationLudusUserId: ludusUserId || fields.userID,
      impersonationSshLogin: resolvedSsh || sshLogin,
    })
  } catch (err) {
    logAppEvent("impersonate_start", "Failed to persist impersonation credentials", {
      username: session.username,
      ip: clientIpFromRequest(request),
      outcome: "failure",
    })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start impersonation" },
      { status: 500 },
    )
  }
  logAppEvent("impersonate_start", `Managing as ${ludusPrincipal}`, {
    username: session.username,
    ip: clientIpFromRequest(request),
    outcome: "success",
  })
  return finishAdminResponse(response, admin)
}

export async function DELETE(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  await clearSessionImpersonation(response, session)
  logAppEvent("impersonate_stop", "Impersonation ended", {
    username: session.username,
    ip: clientIpFromRequest(request),
    outcome: "success",
  })
  return response
}
