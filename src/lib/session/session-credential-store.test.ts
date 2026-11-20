import { describe, expect, it, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { resetDbForTests } from "@/lib/core/db"
import {
  createSessionCredentials,
  deleteSessionCredentials,
  getSessionCredentials,
  updateSessionCredentials,
} from "@/lib/session/session-credential-store"

describe("session-credential-store", () => {
  const prevSecret = process.env.APP_SECRET
  const prevData = process.env.DATA_DIR
  let testData = ""

  beforeEach(() => {
    resetDbForTests()
    process.env.APP_SECRET = "test-app-secret-for-unit-tests"
    testData = fs.mkdtempSync(path.join(os.tmpdir(), "lux-session-creds-"))
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

  it("creates and retrieves credentials", () => {
    createSessionCredentials(
      "sess-1",
      "alice",
      { apiKey: "key-abc", sshPassword: "pw" },
      60_000,
    )
    const creds = getSessionCredentials("sess-1")
    expect(creds?.apiKey).toBe("key-abc")
    expect(creds?.sshPassword).toBe("pw")
  })

  it("updates impersonation key", () => {
    createSessionCredentials("sess-2", "admin", { apiKey: "admin-key" }, 60_000)
    expect(updateSessionCredentials("sess-2", { impersonationApiKey: "user-key" })).toBe(true)
    expect(getSessionCredentials("sess-2")?.impersonationApiKey).toBe("user-key")
  })

  it("deletes credentials", () => {
    createSessionCredentials("sess-3", "bob", { apiKey: "k" }, 60_000)
    deleteSessionCredentials("sess-3")
    expect(getSessionCredentials("sess-3")).toBeNull()
  })
})
