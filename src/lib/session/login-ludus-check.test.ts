import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/ludus/ludus-client", () => ({
  ludusRequest: vi.fn(),
}))

import { ludusRequest } from "@/lib/ludus/ludus-client"
import { checkLudusUser } from "@/lib/session/login-ludus-check"

describe("checkLudusUser", () => {
  const previousTls = process.env.LUDUS_TLS_INSECURE

  beforeEach(() => {
    vi.mocked(ludusRequest).mockReset()
    if (previousTls === undefined) delete process.env.LUDUS_TLS_INSECURE
    else process.env.LUDUS_TLS_INSECURE = previousTls
  })

  it("returns ok when Ludus accepts the key", async () => {
    vi.mocked(ludusRequest).mockResolvedValue({
      status: 200,
      data: [{ userID: "alice", name: "alice", isAdmin: false }],
    })
    const result = await checkLudusUser("key", "alice")
    expect(result).toEqual({ ok: true, isAdmin: false })
  })

  it("returns profile_mismatch when the key belongs to a different user", async () => {
    vi.mocked(ludusRequest).mockResolvedValue({
      status: 200,
      data: [{ userID: "admin", name: "admin", isAdmin: true }],
    })
    const result = await checkLudusUser("admin-key", "alice")
    expect(result).toEqual({ ok: false, kind: "profile_mismatch" })
  })

  it("returns unauthorized on 401", async () => {
    vi.mocked(ludusRequest).mockResolvedValue({ status: 401, error: "unauthorized" })
    const result = await checkLudusUser("bad", "alice")
    expect(result).toEqual({ ok: false, kind: "unauthorized" })
  })

  it("returns unreachable with TLS hint on certificate errors", async () => {
    process.env.LUDUS_TLS_INSECURE = "false"
    vi.mocked(ludusRequest).mockResolvedValue({
      status: 0,
      error: "Connection failed: fetch failed — unable to verify the first certificate",
    })
    const result = await checkLudusUser("key", "alice")
    expect(result).toEqual({
      ok: false,
      kind: "unreachable",
      message: expect.stringMatching(/TLS certificate[\s\S]*LUDUS_TLS_INSECURE/),
    })
    if (result.ok || result.kind !== "unreachable") throw new Error("expected unreachable")
    expect(result.message).not.toMatch(/not set in \.env/)
  })

  it("names the old default when an upgraded .env has no LUDUS_TLS_INSECURE", async () => {
    process.env.LUDUS_TLS_INSECURE = ""
    vi.mocked(ludusRequest).mockResolvedValue({
      status: 0,
      error: "Connection failed: fetch failed — self-signed certificate",
    })
    const result = await checkLudusUser("key", "alice")
    if (result.ok || result.kind !== "unreachable") throw new Error("expected unreachable")
    expect(result.message).toMatch(/LUDUS_TLS_INSECURE is not set in \.env\. Before 1\.5\.0/)
    expect(result.message).toMatch(/LUDUS_TLS_INSECURE=true/)
  })

  it("gives no TLS hint when certificate checks are already off", async () => {
    process.env.LUDUS_TLS_INSECURE = "true"
    vi.mocked(ludusRequest).mockResolvedValue({ status: 0, error: "self-signed certificate" })
    const result = await checkLudusUser("key", "alice")
    if (result.ok || result.kind !== "unreachable") throw new Error("expected unreachable")
    expect(result.message).toBe("Cannot verify Ludus TLS certificate.")
  })
})
