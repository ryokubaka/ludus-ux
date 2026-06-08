/**
 * Edge-safe session cookie crypto (middleware + auth gate).
 * No SQLite — credential vault lives in session-node.ts.
 */

import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

const IS_SECURE_CONTEXT =
  process.env.NODE_ENV === "production" &&
  (process.env.DISABLE_HTTPS !== "true" || process.env.TRUST_PROXY_TLS === "true")

export const SESSION_COOKIE = IS_SECURE_CONTEXT ? "__Host-ludus_session" : "ludus_session"
const LEGACY_SESSION_COOKIE = "ludus_session"

export function sessionTtlMs(): number {
  const hours = Number(process.env.SESSION_MAX_AGE_HOURS ?? "8")
  if (!Number.isFinite(hours) || hours <= 0) return 8 * 60 * 60 * 1000
  return Math.min(hours, 8) * 60 * 60 * 1000
}

const SALT = new TextEncoder().encode("ludus-ux-session-salt-v1")

function getSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

let derivedKeySecretFingerprint = ""
let derivedKeyPromise: Promise<CryptoKey> | null = null

async function deriveKeyFromSecret(): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    "PBKDF2",
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

async function getDerivedKey(): Promise<CryptoKey> {
  const fp = getSecret()
  if (!derivedKeyPromise || derivedKeySecretFingerprint !== fp) {
    derivedKeySecretFingerprint = fp
    derivedKeyPromise = deriveKeyFromSecret()
  }
  return derivedKeyPromise
}

export interface SessionData {
  sessionId: string
  username: string
  isAdmin: boolean
  loginAt: string
  impersonationUserId?: string
  impersonationLudusUserId?: string
  impersonationSshLogin?: string
}

export interface ResolvedSession extends SessionData {
  apiKey: string
  sshPassword?: string
  impersonationApiKey?: string
}

/** Legacy cookies may still embed secrets until migrated. */
export type CookiePayload = SessionData & {
  apiKey?: string
  sshPassword?: string
  impersonationApiKey?: string
}

export function toSessionData(data: CookiePayload): SessionData {
  return {
    sessionId: data.sessionId ?? "",
    username: data.username,
    isAdmin: data.isAdmin,
    loginAt: data.loginAt,
    impersonationUserId: data.impersonationUserId,
    impersonationLudusUserId: data.impersonationLudusUserId,
    impersonationSshLogin: data.impersonationSshLogin,
  }
}

export function isLegacyCookiePayload(data: CookiePayload): boolean {
  return typeof data.apiKey === "string" && data.apiKey.length > 0
}

export async function readCookieToken(request?: NextRequest): Promise<string | null> {
  if (request) {
    const token = request.cookies.get(SESSION_COOKIE)?.value
    if (token) return token
    if (IS_SECURE_CONTEXT) {
      return request.cookies.get(LEGACY_SESSION_COOKIE)?.value ?? null
    }
    return null
  }
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) return token
  if (IS_SECURE_CONTEXT) {
    return cookieStore.get(LEGACY_SESSION_COOKIE)?.value ?? null
  }
  return null
}

export async function encryptSession(data: SessionData): Promise<string> {
  const key = await getDerivedKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.byteLength)

  return btoa(String.fromCharCode(...combined))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

export async function decryptCookiePayload(token: string): Promise<CookiePayload | null> {
  try {
    const key = await getDerivedKey()
    const binary = Uint8Array.from(
      atob(token.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    )
    const iv = binary.slice(0, 12)
    const ciphertext = binary.slice(12)

    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
    const data = JSON.parse(new TextDecoder().decode(decrypted)) as CookiePayload

    if (Date.now() - new Date(data.loginAt).getTime() > sessionTtlMs()) {
      return null
    }
    return data
  } catch {
    return null
  }
}

export async function getSessionFromRequest(request: NextRequest): Promise<SessionData | null> {
  const token = await readCookieToken(request)
  if (!token) return null
  const payload = await decryptCookiePayload(token)
  if (!payload) return null
  return toSessionData(payload)
}

export async function getSession(): Promise<SessionData | null> {
  const token = await readCookieToken()
  if (!token) return null
  const payload = await decryptCookiePayload(token)
  if (!payload) return null
  return toSessionData(payload)
}

export async function setSessionCookie(
  response: NextResponse,
  data: SessionData | CookiePayload,
): Promise<void> {
  // Never persist vault secrets (apiKey, sshPassword, impersonationApiKey) in the cookie.
  const token = await encryptSession(toSessionData(data))
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTtlMs() / 1000,
    secure: IS_SECURE_CONTEXT,
  })

  if (IS_SECURE_CONTEXT) {
    response.cookies.set(LEGACY_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      secure: true,
    })
  }
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    secure: IS_SECURE_CONTEXT,
  })
  if (IS_SECURE_CONTEXT) {
    response.cookies.set(LEGACY_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
      secure: IS_SECURE_CONTEXT,
    })
  }
}
