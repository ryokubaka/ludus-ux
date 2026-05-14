import { NextRequest, NextResponse } from "next/server"
import { authenticateUser, saveApiKeyToBashrc } from "@/lib/auth-ssh"
import { setSessionCookie, type SessionData } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"

/** Ask Ludus for this user's info using their API key — uses GET /user (List user details). */
async function checkLudusUser(apiKey: string, ludusUsername: string): Promise<{ isAdmin: boolean; valid: boolean }> {
  try {
    const result = await ludusRequest<unknown>("/user", { apiKey })
    if (result.error || result.status !== 200) {
      return { isAdmin: false, valid: false }
    }
    const profile = ludusCallerFromGetUser(result.data, ludusUsername)
    if (!profile) return { isAdmin: false, valid: false }
    return { isAdmin: profile.user.isAdmin, valid: true }
  } catch {
    return { isAdmin: false, valid: false }
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { username, password, apiKey: manualApiKey } = body || {}

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 })
  }

  // Second-step: user provides API key manually
  if (manualApiKey) {
    const saveResult = await saveApiKeyToBashrc(username, password, manualApiKey)
    if (!saveResult.success) {
      return NextResponse.json(
        { error: `Failed to save API key to .bashrc: ${saveResult.message}` },
        { status: 500 },
      )
    }
    const { isAdmin, valid } = await checkLudusUser(manualApiKey, username)
    if (!valid) {
      return NextResponse.json({ error: "API key is invalid — please check it and try again" }, { status: 401 })
    }
    const session: SessionData = {
      username,
      apiKey: manualApiKey,
      isAdmin,
      loginAt: new Date().toISOString(),
      sshPassword: password,
    }
    const response = NextResponse.json({ success: true, isAdmin, username })
    await setSessionCookie(response, session)
    return response
  }

  const result = await authenticateUser(username, password)

  if (!result.success) {
    if (result.reason === "no_api_key") {
      return NextResponse.json({ needsApiKey: true, username }, { status: 200 })
    }
    const status = result.reason === "auth_failed" ? 401 : 503
    return NextResponse.json({ error: result.message }, { status })
  }

  const { isAdmin, valid } = await checkLudusUser(result.apiKey, username)

  if (!valid) {
    return NextResponse.json({ needsApiKey: true, username, staleKey: true }, { status: 200 })
  }

  const session: SessionData = {
    username,
    apiKey: result.apiKey,
    isAdmin,
    loginAt: new Date().toISOString(),
    sshPassword: password,
  }
  const response = NextResponse.json({ success: true, isAdmin, username })
  await setSessionCookie(response, session)
  return response
}
