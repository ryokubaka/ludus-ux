/**
 * AES-256-GCM encryption for sensitive values persisted in the SQLite `settings` table.
 * Wire formats:
 *   enc:v1: — legacy SHA256(APP_SECRET) key derivation
 *   enc:v2: — PBKDF2 100k iterations (aligned with session.ts)
 */

import crypto from "crypto"

export const SETTINGS_VALUE_AT_REST_PREFIX = "enc:v1:"
export const SETTINGS_VALUE_AT_REST_PREFIX_V2 = "enc:v2:"

const SETTINGS_SALT = Buffer.from("ludus-ux-settings-salt-v1", "utf8")
const PBKDF2_ITERATIONS = 100_000

function appSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

/** Legacy v1 key — single SHA256 hash. */
function deriveKeyV1(appSecretValue: string): Buffer {
  return crypto.createHash("sha256").update(appSecretValue).digest()
}

/** v2 key — PBKDF2 matching session.ts iteration count. */
function deriveKeyV2(appSecretValue: string): Buffer {
  return crypto.pbkdf2Sync(
    appSecretValue,
    SETTINGS_SALT,
    PBKDF2_ITERATIONS,
    32,
    "sha256",
  )
}

function encryptWithKey(plaintext: string, key: Buffer, prefix: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${prefix}${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`
}

function decryptWithKey(stored: string, prefix: string, key: Buffer): string {
  const raw = Buffer.from(stored.slice(prefix.length), "base64")
  if (raw.length < 29) throw new Error("encrypted setting payload is too short")
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

/** True if the DB cell holds an encrypted payload (not legacy plaintext). */
export function isSettingsValueAtRestEncrypted(stored: string): boolean {
  return (
    !!stored &&
    (stored.startsWith(SETTINGS_VALUE_AT_REST_PREFIX) ||
      stored.startsWith(SETTINGS_VALUE_AT_REST_PREFIX_V2))
  )
}

export function encryptSettingsValueAtRest(plaintext: string, appSecretValue: string): string {
  if (!plaintext) return plaintext
  const secret = appSecretValue || appSecret()
  return encryptWithKey(plaintext, deriveKeyV2(secret), SETTINGS_VALUE_AT_REST_PREFIX_V2)
}

export function decryptSettingsValueAtRest(stored: string, appSecretValue: string): string {
  if (!stored) return stored
  const secret = appSecretValue || appSecret()
  if (stored.startsWith(SETTINGS_VALUE_AT_REST_PREFIX_V2)) {
    return decryptWithKey(stored, SETTINGS_VALUE_AT_REST_PREFIX_V2, deriveKeyV2(secret))
  }
  if (stored.startsWith(SETTINGS_VALUE_AT_REST_PREFIX)) {
    return decryptWithKey(stored, SETTINGS_VALUE_AT_REST_PREFIX, deriveKeyV1(secret))
  }
  return stored
}
