import { describe, expect, it } from "vitest"
import {
  decryptSettingsValueAtRest,
  encryptSettingsValueAtRest,
  isSettingsValueAtRestEncrypted,
  SETTINGS_VALUE_AT_REST_PREFIX,
} from "./settings-value-at-rest"

describe("settings-value-at-rest", () => {
  const secret = "test-app-secret-for-unit-tests"

  it("round-trips arbitrary UTF-8", () => {
    const plain = "root-key-αβγ-🔑"
    const enc = encryptSettingsValueAtRest(plain, secret)
    expect(enc.startsWith(SETTINGS_VALUE_AT_REST_PREFIX)).toBe(true)
    expect(isSettingsValueAtRestEncrypted(enc)).toBe(true)
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
