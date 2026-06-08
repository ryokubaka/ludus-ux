/**
 * Encrypt Ludus API keys persisted in goad_tasks.ludus_api_key.
 * Reuses the settings at-rest wire format (enc:v1: AES-256-GCM).
 */

import {
  decryptSettingsValueAtRest,
  encryptSettingsValueAtRest,
  isSettingsValueAtRestEncrypted,
  SETTINGS_VALUE_AT_REST_PREFIX,
} from "@/lib/settings-value-at-rest"

export { SETTINGS_VALUE_AT_REST_PREFIX }

function appSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

export function isGoadTaskSecretEncrypted(stored: string | null | undefined): boolean {
  return !!stored && isSettingsValueAtRestEncrypted(stored)
}

export function encryptGoadTaskSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext?.trim()) return null
  return encryptSettingsValueAtRest(plaintext.trim(), appSecret())
}

export function decryptGoadTaskSecret(stored: string | null | undefined): string | undefined {
  if (!stored?.trim()) return undefined
  try {
    const decrypted = decryptSettingsValueAtRest(stored, appSecret())
    if (isSettingsValueAtRestEncrypted(decrypted)) return undefined
    return decrypted || undefined
  } catch {
    // Wrong APP_SECRET, corrupted payload, or build-time env mismatch — metadata still loads.
    return undefined
  }
}
