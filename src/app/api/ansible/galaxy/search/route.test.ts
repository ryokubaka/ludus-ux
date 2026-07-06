import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/session", () => ({ resolveSession: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))
vi.mock("@/lib/security-audit-log", () => ({ clientIpFromRequest: () => "1.2.3.4" }))
vi.mock("@/lib/ansible-galaxy-api", () => ({
  searchGalaxyRoles: vi.fn(),
  searchGalaxyCollections: vi.fn(),
}))

import { GET } from "./route"
import { resolveSession } from "@/lib/session"
import { checkRateLimit } from "@/lib/rate-limit"
import { searchGalaxyRoles } from "@/lib/ansible-galaxy-api"

const req = (q = "docker") =>
  ({ url: `http://localhost/api/ansible/galaxy/search?q=${q}&type=role` }) as unknown as Parameters<
    typeof GET
  >[0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/ansible/galaxy/search", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it("returns 429 with Retry-After when rate limited", async () => {
    vi.mocked(resolveSession).mockResolvedValue({ username: "alice" } as never)
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, retryAfterSec: 5 })
    const res = await GET(req())
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("5")
    expect(searchGalaxyRoles).not.toHaveBeenCalled()
  })

  it("passes through results with 200 when authenticated and under limit", async () => {
    vi.mocked(resolveSession).mockResolvedValue({ username: "alice" } as never)
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true })
    vi.mocked(searchGalaxyRoles).mockResolvedValue([{ name: "geerlingguy.docker" }] as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([{ name: "geerlingguy.docker" }])
  })

  it("returns empty items for short queries without hitting upstream", async () => {
    vi.mocked(resolveSession).mockResolvedValue({ username: "alice" } as never)
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true })
    const res = await GET(req("a"))
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(searchGalaxyRoles).not.toHaveBeenCalled()
  })
})
