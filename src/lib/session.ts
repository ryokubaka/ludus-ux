/**
 * Session module — re-exports edge-safe cookie helpers and Node credential vault.
 */

export type { CookiePayload, ResolvedSession, SessionData } from "./session-edge"
export {
  decryptCookiePayload,
  encryptSession,
  getSession,
  getSessionFromRequest,
  isLegacyCookiePayload,
  sessionTtlMs,
  setSessionCookie,
  toSessionData,
} from "./session-edge"

export {
  clearSessionImpersonation,
  clearSessionWithCredentials,
  establishSession,
  maybeMigrateSessionCookie,
  resolveSession,
  resolveSessionFromCookies,
  updateSessionImpersonation,
} from "./session-node"

/** @deprecated Use clearSessionWithCredentials */
export { clearSessionCookie } from "./session-edge"
