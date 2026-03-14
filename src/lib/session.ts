/**
 * Session management using AES-256-GCM encrypted HTTP-only cookies.
 * Uses the Web Crypto API (crypto.subtle) so it works in both the
 * Next.js Edge runtime (middleware) and Node.js API routes.
 */

import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

const SESSION_COOKIE = "ludus_session"
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const SALT = new TextEncoder().encode("ludus-ui-session-salt-v1")

function getSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

/** Derive an AES-256-GCM key from APP_SECRET using PBKDF2 */
async function getDerivedKey(): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    "PBKDF2",
    false,
    ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export interface SessionData {
  username: string
  apiKey: string
  isAdmin: boolean
  loginAt: string
  /** SSH password from login — stored encrypted in the session cookie for GOAD execution */
  sshPassword?: string
}

/** Encrypt session data into a URL-safe base64 string */
export async function encryptSession(data: SessionData): Promise<string> {
  const key = await getDerivedKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)

  // Concatenate iv + ciphertext into a single buffer
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.byteLength)

  // URL-safe base64
  return btoa(String.fromCharCode(...combined))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

/** Decrypt and validate a session cookie value */
export async function decryptSession(token: string): Promise<SessionData | null> {
  try {
    const key = await getDerivedKey()
    const binary = Uint8Array.from(
      atob(token.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    )
    const iv = binary.slice(0, 12)
    const ciphertext = binary.slice(12)

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    )
    const data = JSON.parse(new TextDecoder().decode(decrypted)) as SessionData

    // Reject expired sessions
    if (Date.now() - new Date(data.loginAt).getTime() > SESSION_TTL_MS) {
      return null
    }
    return data
  } catch {
    return null
  }
}

/** Read and decrypt the session from a NextRequest (middleware + API routes) */
export async function getSessionFromRequest(
  request: NextRequest
): Promise<SessionData | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  return decryptSession(token)
}

/** Read and decrypt the session from the Next.js cookie store (server components) */
export async function getSession(): Promise<SessionData | null> {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (!token) return null
  return decryptSession(token)
}

/** Encrypt and attach the session cookie to a response */
export async function setSessionCookie(
  response: NextResponse,
  data: SessionData
): Promise<void> {
  const token = await encryptSession(data)
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // "lax" (not "strict") allows the cookie to be sent on top-level
    // same-site navigations (e.g. clicking a link from Proxmox UI back to
    // our app).  With "strict", navigating here from any external page
    // strips the session cookie → forced re-login → browser re-prompts for
    // the self-signed cert.  "lax" still blocks CSRF on non-safe methods.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === "production" && process.env.DISABLE_HTTPS !== "true",
  })
}

/** Clear the session cookie on a response */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  })
}
