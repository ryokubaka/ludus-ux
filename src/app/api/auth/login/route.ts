import { NextRequest, NextResponse } from "next/server"
import { authenticateUser, saveApiKeyToBashrc } from "@/lib/auth-ssh"
import { setSessionCookie, type SessionData } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"

/** Ask Ludus for this user's info using their API key. Returns null if the key is invalid. */
async function checkLudusUser(apiKey: string): Promise<{ isAdmin: boolean; valid: boolean }> {
  try {
    const result = await ludusRequest<unknown>("/user", { apiKey })
    if (result.error || result.status !== 200) {
      return { isAdmin: false, valid: false }
    }
    const raw = result.data
    // Ludus v2 may return a single UserObject or UserObject[] — handle both
    const user = Array.isArray(raw) ? raw[0] : raw
    if (!user || typeof user !== "object") return { isAdmin: false, valid: true }
    return { isAdmin: (user as Record<string, unknown>).isAdmin === true, valid: true }
  } catch {
    return { isAdmin: false, valid: false }
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { username, password, apiKey: manualApiKey } = body || {}

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required" },
      { status: 400 }
    )
  }

  // Second-step: user provides API key manually
  if (manualApiKey) {
    const saveResult = await saveApiKeyToBashrc(username, password, manualApiKey)
    if (!saveResult.success) {
      return NextResponse.json(
        { error: `Failed to save API key to .bashrc: ${saveResult.message}` },
        { status: 500 }
      )
    }
    const { isAdmin, valid } = await checkLudusUser(manualApiKey)
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

  // Normal login: SSH into Ludus server, read LUDUS_API_KEY from ~/.bashrc
  const result = await authenticateUser(username, password)

  if (!result.success) {
    if (result.reason === "no_api_key") {
      return NextResponse.json({ needsApiKey: true, username }, { status: 200 })
    }
    const status = result.reason === "auth_failed" ? 401 : 503
    return NextResponse.json({ error: result.message }, { status })
  }

  // Verify the API key works and get real admin status from Ludus
  const { isAdmin, valid } = await checkLudusUser(result.apiKey)

  // If the key in .bashrc is stale/invalid, prompt the user to enter their current key
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
