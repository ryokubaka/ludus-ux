import fs from "fs"
import os from "os"
import path from "path"
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { resetDbForTests } from "@/lib/core/db"
import { createSessionCredentials } from "@/lib/session/session-credential-store"
import { resolveSessionPayload } from "@/lib/session/session-node"

describe("resolveSessionPayload impersonation vault", () => {
  const prevSecret = process.env.APP_SECRET
  const prevData = process.env.DATA_DIR
  let testData = ""

  beforeEach(() => {
    resetDbForTests()
    process.env.APP_SECRET = "test-app-secret-for-unit-tests"
    testData = fs.mkdtempSync(path.join(os.tmpdir(), "lux-session-impersonation-"))
    process.env.DATA_DIR = testData
  })

  afterEach(() => {
    resetDbForTests()
    if (prevSecret !== undefined) process.env.APP_SECRET = prevSecret
    else delete process.env.APP_SECRET
    if (prevData !== undefined) process.env.DATA_DIR = prevData
    else delete process.env.DATA_DIR
    fs.rmSync(testData, { recursive: true, force: true })
  })

  it("preserves vault impersonationApiKey when cookie accidentally carries admin apiKey", () => {
    const sessionId = "sess-impersonate-1"
    const loginAt = new Date().toISOString()
    createSessionCredentials(
      sessionId,
      "adminuser",
      { apiKey: "admin-key", impersonationApiKey: "testuser-key" },
      60_000,
    )

    const resolved = resolveSessionPayload({
      sessionId,
      username: "adminuser",
      isAdmin: true,
      loginAt,
      impersonationUserId: "testuser",
      impersonationLudusUserId: "testuser",
      impersonationSshLogin: "testuser",
      apiKey: "admin-key",
    })

    expect(resolved?.apiKey).toBe("admin-key")
    expect(resolved?.impersonationApiKey).toBe("testuser-key")
    expect(resolved?.impersonationUserId).toBe("testuser")
  })

  it("loads impersonation from vault on slim cookie", () => {
    const sessionId = "sess-impersonate-2"
    const loginAt = new Date().toISOString()
    createSessionCredentials(
      sessionId,
      "adminuser",
      { apiKey: "admin-key", impersonationApiKey: "testuser-key" },
      60_000,
    )

    const resolved = resolveSessionPayload({
      sessionId,
      username: "adminuser",
      isAdmin: true,
      loginAt,
      impersonationUserId: "testuser",
      impersonationLudusUserId: "testuser",
      impersonationSshLogin: "testuser",
    })

    expect(resolved?.impersonationApiKey).toBe("testuser-key")
  })
})
