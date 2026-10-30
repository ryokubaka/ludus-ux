import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/session/session-credential-store", () => ({
  getSessionCredentials: vi.fn(),
  createSessionCredentials: vi.fn(),
  deleteSessionCredentials: vi.fn(),
  updateSessionCredentials: vi.fn(),
}))

import { deleteSessionCredentials, getSessionCredentials } from "@/lib/session/session-credential-store"
import { SESSION_COOKIE, encryptSession } from "@/lib/session/session-edge"
import { GET } from "./route"

async function revokeWithCookie(): Promise<Response> {
  const token = await encryptSession({
    sessionId: "sid-1",
    username: "alice",
    isAdmin: false,
    loginAt: new Date().toISOString(),
  })
  return GET(
    new NextRequest("http://localhost/api/auth/revoke", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    }),
  )
}

function clearsSession(res: Response): boolean {
  return (res.headers.get("set-cookie") ?? "").includes(`${SESSION_COOKIE}=;`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/auth/revoke", () => {
  it("leaves a live session alone when another site sends the browser here", async () => {
    vi.mocked(getSessionCredentials).mockReturnValue({ apiKey: "k", sshPassword: "pw" })
    const res = await revokeWithCookie()
    expect(res.headers.get("location")).toBe("http://localhost/")
    expect(clearsSession(res)).toBe(false)
    expect(deleteSessionCredentials).not.toHaveBeenCalled()
  })

  it("clears a cookie whose vault row is gone", async () => {
    vi.mocked(getSessionCredentials).mockReturnValue(null)
    const res = await revokeWithCookie()
    expect(res.headers.get("location")).toBe("http://localhost/login")
    expect(clearsSession(res)).toBe(true)
  })

  it("sends a request with no cookie to login", async () => {
    const res = await GET(new NextRequest("http://localhost/api/auth/revoke"))
    expect(res.headers.get("location")).toBe("http://localhost/login")
  })
})
