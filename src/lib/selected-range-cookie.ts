import "server-only"

import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import type { RangeAccessEntry } from "@/lib/types"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import type { ResolvedSession } from "@/lib/session-edge"
import { sessionTtlMs } from "@/lib/session-edge"

const IS_SECURE_CONTEXT =
  process.env.NODE_ENV === "production" &&
  (process.env.DISABLE_HTTPS !== "true" || process.env.TRUST_PROXY_TLS === "true")

export const SELECTED_RANGE_COOKIE = IS_SECURE_CONTEXT
  ? "__Host-lux_selected_range"
  : "lux_selected_range"

const RANGE_ID = /^[a-zA-Z0-9._-]{1,128}$/

export interface SelectedRangeCookiePayload {
  /** effectiveScopeTag — login|view */
  s: string
  /** Ludus rangeID */
  r: string
}

export function isValidSelectedRangeId(rangeId: string): boolean {
  return RANGE_ID.test(rangeId.trim())
}

export function encodeSelectedRangeCookie(scopeTag: string, rangeId: string): string {
  return JSON.stringify({ s: scopeTag, r: rangeId } satisfies SelectedRangeCookiePayload)
}

export function decodeSelectedRangeCookie(raw: string | undefined): SelectedRangeCookiePayload | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SelectedRangeCookiePayload>
    if (typeof parsed.s !== "string" || typeof parsed.r !== "string") return null
    if (!parsed.s.trim() || !isValidSelectedRangeId(parsed.r)) return null
    return { s: parsed.s.trim(), r: parsed.r.trim() }
  } catch {
    return null
  }
}

export async function readSelectedRangeCookie(): Promise<SelectedRangeCookiePayload | null> {
  const cookieStore = await cookies()
  return decodeSelectedRangeCookie(cookieStore.get(SELECTED_RANGE_COOKIE)?.value)
}

export function applySelectedRangeCookie(
  response: NextResponse,
  scopeTag: string,
  rangeId: string,
): void {
  response.cookies.set(SELECTED_RANGE_COOKIE, encodeSelectedRangeCookie(scopeTag, rangeId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTtlMs() / 1000,
    secure: IS_SECURE_CONTEXT,
  })
}

export function clearSelectedRangeCookie(response: NextResponse): void {
  response.cookies.set(SELECTED_RANGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    secure: IS_SECURE_CONTEXT,
  })
}

/**
 * Resolve active range for SSR prefetch: cookie (scope-matched) → first accessible → null.
 */
export function resolveSelectedRangeId(
  session: Pick<ResolvedSession, "username" | "impersonationUserId">,
  cookie: SelectedRangeCookiePayload | null,
  accessibleRanges: RangeAccessEntry[] | null | undefined,
): string | null {
  const scopeTag = effectiveScopeTagFromSession(session)
  if (cookie?.s === scopeTag && isValidSelectedRangeId(cookie.r)) {
    if (!accessibleRanges?.length) return cookie.r
    if (accessibleRanges.some((e) => e.rangeID === cookie.r)) return cookie.r
  }
  if (accessibleRanges?.length) return accessibleRanges[0].rangeID
  return null
}
