import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("./ludus-client", () => ({
  ludusRequest: vi.fn(),
}))

vi.mock("./tls-insecure-env", () => ({
  isLudusTlsInsecure: vi.fn(() => false),
}))

import { ludusRequest } from "./ludus-client"
import { checkLudusUser } from "./login-ludus-check"

describe("checkLudusUser", () => {
  beforeEach(() => {
    vi.mocked(ludusRequest).mockReset()
  })

  it("returns ok when Ludus accepts the key", async () => {
    vi.mocked(ludusRequest).mockResolvedValue({
      status: 200,
      data: [{ userID: "alice", name: "alice", isAdmin: false }],
    })
    const result = await checkLudusUser("key", "alice")
    expect(result).toEqual({ ok: true, isAdmin: false })
  })

  it("returns unauthorized on 401", async () => {
    vi.mocked(ludusRequest).mockResolvedValue({ status: 401, error: "unauthorized" })
    const result = await checkLudusUser("bad", "alice")
    expect(result).toEqual({ ok: false, kind: "unauthorized" })
  })

  it("returns unreachable with TLS hint on certificate errors", async () => {
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
  })
})
