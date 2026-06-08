import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/require-admin"

const resolveSession = vi.fn()
const resolveLudusIsAdmin = vi.fn()
const setSessionCookie = vi.fn()

vi.mock("@/lib/session", () => ({
  resolveSession: (...args: unknown[]) => resolveSession(...args),
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}))

vi.mock("@/lib/session-admin-check", () => ({
  resolveLudusIsAdmin: (...args: unknown[]) => resolveLudusIsAdmin(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requireAdmin", () => {
  it("returns 401 when not authenticated", async () => {
    resolveSession.mockResolvedValue(null)
    const result = await requireAdmin(new NextRequest("http://localhost/api/admin/vm"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it("returns 403 when Ludus says non-admin but cookie says admin", async () => {
    resolveSession.mockResolvedValue({
      sessionId: "s1",
      username: "admin",
      isAdmin: true,
      loginAt: new Date().toISOString(),
      apiKey: "key",
    })
    resolveLudusIsAdmin.mockResolvedValue(false)
    setSessionCookie.mockResolvedValue(undefined)

    const result = await requireAdmin(new NextRequest("http://localhost/api/admin/vm"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
    expect(setSessionCookie).toHaveBeenCalled()
  })

  it("allows live admin and offers cookie refresh when promoted", async () => {
    resolveSession.mockResolvedValue({
      sessionId: "s1",
      username: "user",
      isAdmin: false,
      loginAt: new Date().toISOString(),
      apiKey: "key",
    })
    resolveLudusIsAdmin.mockResolvedValue(true)

    const result = await requireAdmin(new NextRequest("http://localhost/api/admin/vm"))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.isAdmin).toBe(true)
      expect(result.applyCookieRefresh).toBeDefined()
    }
  })
})
