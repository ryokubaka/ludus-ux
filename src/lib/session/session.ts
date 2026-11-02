/**
 * Session module — re-exports edge-safe cookie helpers and Node credential vault.
 */

export type { CookiePayload, ResolvedSession, SessionData } from "@/lib/session/session-edge"
export {
  decryptCookiePayload,
  encryptSession,
  getSession,
  getSessionFromRequest,
  isLegacyCookiePayload,
  sessionTtlMs,
  setSessionCookie,
  toSessionData,
} from "@/lib/session/session-edge"

export {
  clearSessionImpersonation,
  clearSessionWithCredentials,
  establishSession,
  maybeMigrateSessionCookie,
  resolveSession,
  resolveSessionFromCookies,
  updateSessionImpersonation,
} from "@/lib/session/session-node"

/** @deprecated Use clearSessionWithCredentials */
export { clearSessionCookie } from "@/lib/session/session-edge"
