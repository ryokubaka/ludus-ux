import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session/session-credential-store", () => ({
  getSessionCredentials: vi.fn(),
  createSessionCredentials: vi.fn(),
  deleteSessionCredentials: vi.fn(),
  updateSessionCredentials: vi.fn(),
}))

import { getSessionCredentials } from "@/lib/session/session-credential-store"
import { layoutSessionFromPayload } from "@/lib/session/session-layout"

const payload = {
  sessionId: "sid",
  username: "alice",
  isAdmin: true,
  loginAt: "2026-01-01T00:00:00.000Z",
}

describe("layoutSessionFromPayload", () => {
  beforeEach(() => {
    vi.mocked(getSessionCredentials).mockReset()
  })

  it("treats a cookie with no vault row as logged out", () => {
    vi.mocked(getSessionCredentials).mockReturnValue(null)
    const layout = layoutSessionFromPayload(payload)
    expect(layout.revoked).toBe(true)
    expect(layout.session).toBeNull()
    expect(layout.resolved).toBeNull()
  })

  it("keeps the session when the vault row is present", () => {
    vi.mocked(getSessionCredentials).mockReturnValue({ apiKey: "user-key", sshPassword: "pw" })
    const layout = layoutSessionFromPayload(payload)
    expect(layout.revoked).toBe(false)
    expect(layout.session?.username).toBe("alice")
    expect(layout.resolved?.apiKey).toBe("user-key")
  })
})
