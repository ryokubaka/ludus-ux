/**
 * Server-side credential vault for session secrets (API keys, SSH passwords).
 * Cookie holds only an opaque sessionId; credentials live encrypted in SQLite.
 */

import { getDb } from "./db"
import {
  decryptSettingsValueAtRest,
  encryptSettingsValueAtRest,
} from "./settings-value-at-rest"

export interface SessionCredentialPayload {
  apiKey: string
  sshPassword?: string
  impersonationApiKey?: string
}

function appSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

function encryptPayload(payload: SessionCredentialPayload): string {
  return encryptSettingsValueAtRest(JSON.stringify(payload), appSecret())
}

function decryptPayload(stored: string): SessionCredentialPayload | null {
  try {
    const json = decryptSettingsValueAtRest(stored, appSecret())
    const parsed = JSON.parse(json) as SessionCredentialPayload
    if (!parsed?.apiKey?.trim()) return null
    return {
      apiKey: parsed.apiKey.trim(),
      sshPassword: parsed.sshPassword,
      impersonationApiKey: parsed.impersonationApiKey?.trim() || undefined,
    }
  } catch {
    return null
  }
}

export function purgeExpiredSessionCredentials(): void {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM lux_session_credentials WHERE expires_at < ?`).run(Date.now())
  } catch (err) {
    console.error("[session-credential-store] purge failed:", err)
  }
}

export function createSessionCredentials(
  sessionId: string,
  username: string,
  payload: SessionCredentialPayload,
  ttlMs: number,
): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO lux_session_credentials
         (session_id, username, payload_enc, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, username, encryptPayload(payload), now + ttlMs, now)
}

export function getSessionCredentials(sessionId: string): SessionCredentialPayload | null {
  purgeExpiredSessionCredentials()
  const row = getDb()
    .prepare(
      `SELECT payload_enc, expires_at FROM lux_session_credentials WHERE session_id = ?`,
    )
    .get(sessionId) as { payload_enc: string; expires_at: number } | undefined
  if (!row || row.expires_at < Date.now()) {
    if (row) deleteSessionCredentials(sessionId)
    return null
  }
  return decryptPayload(row.payload_enc)
}

export function updateSessionCredentials(
  sessionId: string,
  partial: Partial<SessionCredentialPayload>,
): boolean {
  const existing = getSessionCredentials(sessionId)
  if (!existing) return false
  const row = getDb()
    .prepare(`SELECT username, expires_at FROM lux_session_credentials WHERE session_id = ?`)
    .get(sessionId) as { username: string; expires_at: number } | undefined
  if (!row) return false
  const merged: SessionCredentialPayload = {
    apiKey: partial.apiKey?.trim() || existing.apiKey,
    sshPassword: partial.sshPassword !== undefined ? partial.sshPassword : existing.sshPassword,
  }
  if ("impersonationApiKey" in partial) {
    merged.impersonationApiKey = partial.impersonationApiKey?.trim() || undefined
  } else {
    merged.impersonationApiKey = existing.impersonationApiKey
  }
  getDb()
    .prepare(`UPDATE lux_session_credentials SET payload_enc = ? WHERE session_id = ?`)
    .run(encryptPayload(merged), sessionId)
  return true
}

export function deleteSessionCredentials(sessionId: string): void {
  try {
    getDb().prepare(`DELETE FROM lux_session_credentials WHERE session_id = ?`).run(sessionId)
  } catch {
    /* ignore */
  }
}
