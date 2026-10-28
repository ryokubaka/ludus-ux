import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
  finishAdminResponse: vi.fn(async (response: NextResponse) => response),
}))
vi.mock("@/lib/lux-api-audit", () => ({ logLuxRouteAction: vi.fn() }))
vi.mock("@/lib/ssh-host-key", () => ({
  forgetSshHostKey: vi.fn(() => true),
  listStoredSshHostKeys: vi.fn(() => [{ host: "ludus.example", port: 22, fingerprint: "SHA256:abc=" }]),
}))

import { requireAdmin } from "@/lib/require-admin"
import { forgetSshHostKey } from "@/lib/ssh-host-key"
import { DELETE, GET } from "./route"

function forget(body: Record<string, unknown>) {
  return DELETE(
    new NextRequest("http://localhost/api/settings/ssh-host-key", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/api/settings/ssh-host-key", () => {
  it("refuses a non-admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    })
    expect((await forget({ host: "ludus.example", port: 22 })).status).toBe(403)
    expect((await GET(new NextRequest("http://localhost/api/settings/ssh-host-key"))).status).toBe(403)
    expect(forgetSshHostKey).not.toHaveBeenCalled()
  })

  it("lists and forgets a stored key for an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, session: { username: "admin", isAdmin: true } } as never)
    const listed = await GET(new NextRequest("http://localhost/api/settings/ssh-host-key"))
    expect((await listed.json()).keys[0].fingerprint).toBe("SHA256:abc=")
    const res = await forget({ host: "ludus.example", port: 22 })
    expect(res.status).toBe(200)
    expect(forgetSshHostKey).toHaveBeenCalledWith("ludus.example", 22)
  })

  it("rejects a missing host or bad port", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, session: { username: "admin", isAdmin: true } } as never)
    expect((await forget({ port: 22 })).status).toBe(400)
    expect((await forget({ host: "ludus.example", port: 70000 })).status).toBe(400)
  })
})
