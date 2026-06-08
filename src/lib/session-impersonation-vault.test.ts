import fs from "fs"
import path from "path"
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { createSessionCredentials } from "./session-credential-store"
import { resolveSessionPayload } from "./session-node"

const TEST_DATA = path.join(process.cwd(), "data-test-session-impersonation")

describe("resolveSessionPayload impersonation vault", () => {
  const prevSecret = process.env.APP_SECRET
  const prevData = process.env.DATA_DIR

  beforeEach(() => {
    process.env.APP_SECRET = "test-app-secret-for-unit-tests"
    fs.mkdirSync(TEST_DATA, { recursive: true })
    process.env.DATA_DIR = TEST_DATA
    const dbFile = path.join(TEST_DATA, "ludus-ux.db")
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  })

  afterEach(() => {
    if (prevSecret !== undefined) process.env.APP_SECRET = prevSecret
    else delete process.env.APP_SECRET
    if (prevData !== undefined) process.env.DATA_DIR = prevData
    else delete process.env.DATA_DIR
  })

  it("preserves vault impersonationApiKey when cookie accidentally carries admin apiKey", () => {
    const sessionId = "sess-impersonate-1"
    const loginAt = new Date().toISOString()
    createSessionCredentials(
      sessionId,
      "smeowden",
      { apiKey: "admin-key", impersonationApiKey: "testuser-key" },
      60_000,
    )

    const resolved = resolveSessionPayload({
      sessionId,
      username: "smeowden",
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
      "smeowden",
      { apiKey: "admin-key", impersonationApiKey: "testuser-key" },
      60_000,
    )

    const resolved = resolveSessionPayload({
      sessionId,
      username: "smeowden",
      isAdmin: true,
      loginAt,
      impersonationUserId: "testuser",
      impersonationLudusUserId: "testuser",
      impersonationSshLogin: "testuser",
    })

    expect(resolved?.impersonationApiKey).toBe("testuser-key")
  })
})
