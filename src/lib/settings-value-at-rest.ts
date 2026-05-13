/**
 * AES-256-GCM encryption for sensitive values persisted in the SQLite `settings` table.
 * Same wire format as historical `proxmoxSshPassword` rows (`enc:v1:` prefix).
 */

import crypto from "crypto"

export const SETTINGS_VALUE_AT_REST_PREFIX = "enc:v1:"

function deriveKey(appSecret: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(appSecret || "change-me-in-production-32-chars!!")
    .digest()
}

/** True if the DB cell holds an encrypted payload (not legacy plaintext). */
export function isSettingsValueAtRestEncrypted(stored: string): boolean {
  return !!stored && stored.startsWith(SETTINGS_VALUE_AT_REST_PREFIX)
}

export function encryptSettingsValueAtRest(plaintext: string, appSecret: string): string {
  if (!plaintext) return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(appSecret), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${SETTINGS_VALUE_AT_REST_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`
}

export function decryptSettingsValueAtRest(stored: string, appSecret: string): string {
  if (!stored || !stored.startsWith(SETTINGS_VALUE_AT_REST_PREFIX)) return stored
  const raw = Buffer.from(stored.slice(SETTINGS_VALUE_AT_REST_PREFIX.length), "base64")
  if (raw.length < 29) throw new Error("encrypted setting payload is too short")
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(appSecret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
