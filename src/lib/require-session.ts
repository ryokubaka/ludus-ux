import { NextRequest, NextResponse } from "next/server"
import { resolveSession, type ResolvedSession } from "@/lib/session"

export type RequireSessionResult =
  | { ok: true; session: ResolvedSession }
  | { ok: false; response: NextResponse }

/**
 * Gate authenticated routes. Returns the resolved session or a 401 error response.
 */
export async function requireSession(
  request: NextRequest,
): Promise<RequireSessionResult> {
  const session = await resolveSession(request)
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    }
  }
  return { ok: true, session }
}

/**
 * Parse the request body as JSON, returning a fallback on failure.
 * Avoids the repeated `try { body = await request.json() } catch { body = {} }` pattern.
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  request: NextRequest,
  fallback: T = {} as T,
): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return fallback
  }
}
