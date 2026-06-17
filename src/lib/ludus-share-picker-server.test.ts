import { describe, expect, it } from "vitest"
import { resolveSharePickerDirectoryApiKeys } from "./ludus-share-picker-server"

describe("resolveSharePickerDirectoryApiKeys", () => {
  it("prefers operator key for non-admin sessions", () => {
    const keys = resolveSharePickerDirectoryApiKeys({
      sessionId: "s1",
      username: "alice",
      apiKey: "alice-key",
      isAdmin: false,
      loginAt: new Date(0).toISOString(),
    })
    expect(keys[0]).toBe("alice-key")
    expect(keys).toEqual(["alice-key"])
  })

  it("dedupes admin session key with operator key", () => {
    const keys = resolveSharePickerDirectoryApiKeys({
      sessionId: "s1",
      username: "admin",
      apiKey: "admin-key",
      isAdmin: true,
      loginAt: new Date(0).toISOString(),
    })
    expect(keys).toEqual(["admin-key"])
  })
})
