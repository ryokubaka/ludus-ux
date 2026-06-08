import crypto from "crypto"
import { describe, expect, it } from "vitest"
import {
  decryptSettingsValueAtRest,
  encryptSettingsValueAtRest,
  isSettingsValueAtRestEncrypted,
  SETTINGS_VALUE_AT_REST_PREFIX,
} from "./settings-value-at-rest"

describe("settings-value-at-rest", () => {
  const secret = "test-app-secret-for-unit-tests"

  it("round-trips arbitrary UTF-8 (v2 PBKDF2)", () => {
    const plain = "root-key-αβγ-🔑"
    const enc = encryptSettingsValueAtRest(plain, secret)
    expect(enc.startsWith("enc:v2:")).toBe(true)
    expect(isSettingsValueAtRestEncrypted(enc)).toBe(true)
    expect(decryptSettingsValueAtRest(enc, secret)).toBe(plain)
  })

  it("decrypts legacy v1 ciphertext", () => {
    const plain = "legacy-secret"
    const iv = Buffer.alloc(12, 1)
    const key = crypto.createHash("sha256").update(secret).digest()
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    const enc = `${SETTINGS_VALUE_AT_REST_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`
    expect(decryptSettingsValueAtRest(enc, secret)).toBe(plain)
  })

  it("empty string is not encrypted", () => {
    expect(encryptSettingsValueAtRest("", secret)).toBe("")
    expect(isSettingsValueAtRestEncrypted("")).toBe(false)
  })

  it("legacy plaintext passes through decrypt unchanged", () => {
    const legacy = "not-encrypted-yet"
    expect(decryptSettingsValueAtRest(legacy, secret)).toBe(legacy)
    expect(isSettingsValueAtRestEncrypted(legacy)).toBe(false)
  })

  it("wrong secret fails authentication", () => {
    const enc = encryptSettingsValueAtRest("sensitive", secret)
    expect(() => decryptSettingsValueAtRest(enc, "other-secret")).toThrow()
  })
})
