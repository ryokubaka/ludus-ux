import "server-only"

import { cache } from "react"
import {
  decryptCookiePayload,
  readCookieToken,
  toSessionData,
  type SessionData,
} from "@/lib/session-edge"
import type { ResolvedSession } from "@/lib/session-edge"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import { resolveSessionPayload } from "@/lib/session-node"

export type LayoutSession = {
  session: SessionData | null
  resolved: ResolvedSession | null
}

/** One cookie read + decrypt per request (deduped via React.cache). */
export const getLayoutSession = cache(async (): Promise<LayoutSession> => {
  await markRouteDynamic()
  const token = await readCookieToken()
  if (!token) return { session: null, resolved: null }
  const payload = await decryptCookiePayload(token)
  if (!payload) return { session: null, resolved: null }
  return {
    session: toSessionData(payload),
    resolved: resolveSessionPayload(payload),
  }
})
