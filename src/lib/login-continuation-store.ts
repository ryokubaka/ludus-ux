/**
 * Short-lived, server-side storage for SSH credentials between login steps.
 * Avoids re-sending the SSH password from the browser on the API-key step.
 */

import crypto from "crypto"
import { getDb } from "./db"
import {
  decryptSettingsValueAtRest,
  encryptSettingsValueAtRest,
} from "./settings-value-at-rest"

const DEFAULT_TTL_MS = 5 * 60 * 1000

function appSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

function encryptPassword(password: string): string {
  return encryptSettingsValueAtRest(password, appSecret())
}

function decryptPassword(stored: string): string | null {
  try {
    return decryptSettingsValueAtRest(stored, appSecret())
  } catch {
    return null
  }
}

export function purgeExpiredLoginContinuations(): void {
  try {
    getDb()
      .prepare(`DELETE FROM lux_login_continuations WHERE expires_at < ?`)
      .run(Date.now())
  } catch (err) {
    console.error("[login-continuation] purge failed:", err)
  }
}

/** Issue a one-time token after SSH auth; password stays server-side until consumed. */
export function createLoginContinuation(
  username: string,
  sshPassword: string,
  ttlMs = DEFAULT_TTL_MS,
): string {
  purgeExpiredLoginContinuations()
  const token = crypto.randomBytes(32).toString("hex")
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO lux_login_continuations
         (token, username, password_enc, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(token, username, encryptPassword(sshPassword), now + ttlMs, now)
  return token
}

/** Single-use: returns credentials and deletes the row. */
export function consumeLoginContinuation(
  token: string,
): { username: string; sshPassword: string } | null {
  purgeExpiredLoginContinuations()
  const row = getDb()
    .prepare(
      `SELECT username, password_enc, expires_at
       FROM lux_login_continuations WHERE token = ?`,
    )
    .get(token) as
    | { username: string; password_enc: string; expires_at: number }
    | undefined

  if (!row || row.expires_at < Date.now()) {
    if (row) {
      getDb().prepare(`DELETE FROM lux_login_continuations WHERE token = ?`).run(token)
    }
    return null
  }

  const sshPassword = decryptPassword(row.password_enc)
  getDb().prepare(`DELETE FROM lux_login_continuations WHERE token = ?`).run(token)
  if (!sshPassword) return null
  return { username: row.username, sshPassword }
}
