import crypto from "crypto"
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import {
  createSessionCredentials,
  deleteSessionCredentials,
  getSessionCredentials,
  updateSessionCredentials,
} from "./session-credential-store"

const TEST_DATA = path.join(process.cwd(), "data-test-session-creds")

describe("session-credential-store", () => {
  const prevSecret = process.env.APP_SECRET
  const prevData = process.env.DATA_DIR

  beforeEach(() => {
    process.env.APP_SECRET = "test-app-secret-for-unit-tests"
    fs.mkdirSync(TEST_DATA, { recursive: true })
    process.env.DATA_DIR = TEST_DATA
    // Reset db singleton by deleting test db
    const dbFile = path.join(TEST_DATA, "ludus-ux.db")
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile)
    const wal = `${dbFile}-wal`
    const shm = `${dbFile}-shm`
    if (fs.existsSync(wal)) fs.unlinkSync(wal)
    if (fs.existsSync(shm)) fs.unlinkSync(shm)
  })

  afterEach(() => {
    if (prevSecret !== undefined) process.env.APP_SECRET = prevSecret
    else delete process.env.APP_SECRET
    if (prevData !== undefined) process.env.DATA_DIR = prevData
    else delete process.env.DATA_DIR
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
