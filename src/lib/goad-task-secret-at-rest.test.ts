import { describe, expect, it } from "vitest"
import { SETTINGS_VALUE_AT_REST_PREFIX_V2 } from "./settings-value-at-rest"
import {
  decryptGoadTaskSecret,
  encryptGoadTaskSecret,
  isGoadTaskSecretEncrypted,
} from "./goad-task-secret-at-rest"

describe("goad-task-secret-at-rest", () => {
  const prev = process.env.APP_SECRET
  process.env.APP_SECRET = "test-app-secret-for-unit-tests"

  it("round-trips Ludus API key", () => {
    const plain = "ludus-api-key-abc123"
    const enc = encryptGoadTaskSecret(plain)
    expect(enc?.startsWith(SETTINGS_VALUE_AT_REST_PREFIX_V2)).toBe(true)
    expect(isGoadTaskSecretEncrypted(enc)).toBe(true)
    expect(decryptGoadTaskSecret(enc)).toBe(plain)
  })

  it("null/empty returns null", () => {
    expect(encryptGoadTaskSecret(null)).toBe(null)
    expect(encryptGoadTaskSecret("")).toBe(null)
    expect(decryptGoadTaskSecret(null)).toBe(undefined)
  })

  it("legacy plaintext passes through decrypt unchanged", () => {
    const legacy = "plaintext-ludus-key"
    expect(decryptGoadTaskSecret(legacy)).toBe(legacy)
    expect(isGoadTaskSecretEncrypted(legacy)).toBe(false)
  })

  it("wrong secret returns undefined without throwing", () => {
    const enc = encryptGoadTaskSecret("sensitive-key")!
    process.env.APP_SECRET = "other-secret"
    expect(decryptGoadTaskSecret(enc)).toBe(undefined)
    process.env.APP_SECRET = "test-app-secret-for-unit-tests"
  })

  if (prev !== undefined) process.env.APP_SECRET = prev
})
