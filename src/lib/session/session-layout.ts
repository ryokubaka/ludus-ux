import "server-only"

import { cache } from "react"
import {
  decryptCookiePayload,
  readCookieToken,
  toSessionData,
  type CookiePayload,
  type SessionData,
} from "@/lib/session/session-edge"
import type { ResolvedSession } from "@/lib/session/session-edge"
import { markRouteDynamic } from "@/lib/core/mark-route-dynamic"
import { resolveSessionPayload } from "@/lib/session/session-node"

export type LayoutSession = {
  session: SessionData | null
  resolved: ResolvedSession | null
  /** The cookie decrypted, but logout already deleted the credential vault row. */
  revoked: boolean
}

/** Cookie plus vault. A decrypted cookie with no vault row is logged out. */
export function layoutSessionFromPayload(payload: CookiePayload | null): LayoutSession {
  if (!payload) return { session: null, resolved: null, revoked: false }
  const resolved = resolveSessionPayload(payload)
  if (!resolved) return { session: null, resolved: null, revoked: true }
  return { session: toSessionData(payload), resolved, revoked: false }
}

/** One cookie read + decrypt per request (deduped via React.cache). */
export const getLayoutSession = cache(async (): Promise<LayoutSession> => {
  await markRouteDynamic()
  const token = await readCookieToken()
  if (!token) return { session: null, resolved: null, revoked: false }
  const payload = await decryptCookiePayload(token)
  return layoutSessionFromPayload(payload)
})
