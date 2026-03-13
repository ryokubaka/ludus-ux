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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
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

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
