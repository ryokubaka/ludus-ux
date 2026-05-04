import { NextRequest, NextResponse } from "next/server"
import { authenticateUser, saveApiKeyToBashrc } from "@/lib/auth-ssh"
import { setSessionCookie, type SessionData } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"

function userIdFromRecord(u: Record<string, unknown>): string {
  const id = u.userID ?? u.user_id
  return typeof id === "string" ? id : ""
}

function isAdminFromRecord(u: Record<string, unknown>): boolean {
  return u.isAdmin === true || u.is_admin === true
}

/**
 * Pick the UserObject for this login from GET /user (single object, or array when
 * Ludus returns several users — never assume `array[0]` is the current user).
 */
function pickUserRecord(raw: unknown, ludusUsername: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null
  const list: Record<string, unknown>[] = Array.isArray(raw)
    ? raw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [raw as Record<string, unknown>]
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  const want = ludusUsername.trim().toLowerCase()
  const matched = list.find((u) => userIdFromRecord(u).toLowerCase() === want)
  return matched ?? null
}

/** Ask Ludus for this user's info using their API key. */
async function checkLudusUser(apiKey: string, ludusUsername: string): Promise<{ isAdmin: boolean; valid: boolean }> {
  try {
    const result = await ludusRequest<unknown>("/user", { apiKey })
    if (result.error || result.status !== 200) {
      return { isAdmin: false, valid: false }
    }
    const user = pickUserRecord(result.data, ludusUsername)
    if (!user) return { isAdmin: false, valid: true }
    return { isAdmin: isAdminFromRecord(user), valid: true }
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
  const { isAdmin, valid } = await checkLudusUser(result.apiKey, username)

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
