import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"

// Paths that are always public
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/_next",
  "/favicon",
]

const IS_HTTPS =
  process.env.NODE_ENV === "production" && process.env.DISABLE_HTTPS !== "true"

/**
 * Apply security response headers to every response from our app.
 *
 * These headers are the HTTP-level countermeasures for the shared-hostname
 * problem (our app on :443, Proxmox on :8006, same IP).  They don't prevent
 * Proxmox's cookies from arriving in browser requests — that's handled at the
 * cookie level by the __Host- prefix in session.ts — but they harden against
 * framing, MIME confusion, and accidental credential leakage.
 */
function applySecurityHeaders(response: NextResponse): void {
  // Prevent browsers from guessing a different content type than declared
  response.headers.set("X-Content-Type-Options", "nosniff")

  // Allow framing only from the same origin (Proxmox runs on a different port
  // so this also prevents our app being framed inside the Proxmox UI)
  response.headers.set("X-Frame-Options", "SAMEORIGIN")

  // Don't leak the full URL in the Referer header when navigating to a
  // different origin (e.g. following an external link from our app)
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")

  // Disable legacy XSS auditor — modern browsers use CSP instead and the
  // auditor is known to introduce new vulnerabilities
  response.headers.set("X-XSS-Protection", "0")

  // Permissions policy: opt out of browser features this app doesn't need
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  )

  // HSTS: once the browser has seen our HTTPS response, refuse plain HTTP
  // for the next two years.  Only set on HTTPS deployments.
  if (IS_HTTPS) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    )
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    const response = NextResponse.next()
    applySecurityHeaders(response)
    return response
  }

  const session = await getSessionFromRequest(request)

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  const response = NextResponse.next()
  applySecurityHeaders(response)
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
