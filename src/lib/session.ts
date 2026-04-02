/**
 * Session management using AES-256-GCM encrypted HTTP-only cookies.
 * Uses the Web Crypto API (crypto.subtle) so it works in both the
 * Next.js Edge runtime (middleware) and Node.js API routes.
 *
 * Cookie isolation on shared-hostname deployments
 * ─────────────────────────────────────────────────
 * Ludus UX and Proxmox commonly run on the same host at different ports
 * (e.g. :443 and :8006).  HTTP cookies are domain-scoped, NOT port-scoped,
 * so Proxmox's PVEAuthCookie arrives in every request to our app.
 *
 * On HTTPS (production) we use the "__Host-" cookie prefix (RFC 6265bis).
 * This instructs the browser to enforce three hard constraints:
 *   1. Secure attribute is required — cookie only travels over HTTPS.
 *   2. Path must be "/" — no path-scoping loopholes.
 *   3. No Domain attribute allowed — cookie is bound to the exact origin.
 * The net effect: no other service on the same hostname (including Proxmox
 * on a different port) can set or overwrite our session cookie.  The
 * PVEAuthCookie continues to coexist harmlessly in browser requests; our
 * session token is cryptographically isolated from it.
 *
 * On plain HTTP (development / DISABLE_HTTPS=true) the __Host- prefix
 * requires Secure which isn't available, so we fall back to the
 * unprefixed name "ludus_session" for local development only.
 */

import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

/**
 * Whether the runtime environment serves over HTTPS.
 * The __Host- prefix REQUIRES the Secure attribute; using it on plain HTTP
 * causes browsers to silently drop the Set-Cookie entirely.
 */
const IS_SECURE_CONTEXT =
  process.env.NODE_ENV === "production" && process.env.DISABLE_HTTPS !== "true"

/**
 * Cookie name.
 * Production HTTPS  → "__Host-ludus_session" (browser-enforced origin binding)
 * Development HTTP  → "ludus_session"        (standard cookie, no prefix guards)
 *
 * Legacy fallback: if a browser still holds the old unprefixed "ludus_session"
 * from a previous version, getSessionFromRequest will try it as a fallback so
 * users aren't silently logged out on upgrade.
 */
const SESSION_COOKIE = IS_SECURE_CONTEXT ? "__Host-ludus_session" : "ludus_session"
const LEGACY_SESSION_COOKIE = "ludus_session"

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const SALT = new TextEncoder().encode("ludus-ux-session-salt-v1")

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
  /** Set when an admin is actively impersonating another user. */
  impersonationApiKey?: string
  impersonationUserId?: string
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
  // Try the canonical (possibly __Host-prefixed) cookie first.
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (token) return decryptSession(token)

  // Legacy fallback: if upgrading from a version that used the unprefixed name,
  // accept the old cookie for one request so the user isn't silently logged out.
  // setSessionCookie() will re-issue under the new name in the same response.
  if (IS_SECURE_CONTEXT) {
    const legacyToken = request.cookies.get(LEGACY_SESSION_COOKIE)?.value
    if (legacyToken) return decryptSession(legacyToken)
  }

  return null
}

/** Read and decrypt the session from the Next.js cookie store (server components) */
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) return decryptSession(token)

  if (IS_SECURE_CONTEXT) {
    const legacyToken = cookieStore.get(LEGACY_SESSION_COOKIE)?.value
    if (legacyToken) return decryptSession(legacyToken)
  }

  return null
}

/** Encrypt and attach the session cookie to a response */
export async function setSessionCookie(
  response: NextResponse,
  data: SessionData
): Promise<void> {
  const token = await encryptSession(data)
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // "lax" allows the cookie to be sent on top-level same-site navigations
    // (e.g. clicking a link from Proxmox UI back to our app).  "strict" would
    // strip it on every cross-origin navigation and force re-login.
    // The __Host- prefix already provides origin binding; Lax handles UX.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure: IS_SECURE_CONTEXT,
  })

  // If we just issued a prefixed cookie, also expire the legacy unprefixed one
  // so browsers don't accumulate both names after an upgrade.
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

/** Clear the session cookie on a response */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    secure: IS_SECURE_CONTEXT,
  })
  // Clear legacy name too, in case it's still in the browser
  if (IS_SECURE_CONTEXT) {
    response.cookies.set(LEGACY_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
      secure: true,
    })
  }
}
