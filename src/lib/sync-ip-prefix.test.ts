import { describe, expect, it } from "vitest"
import { sedPatternForIpPrefix } from "./sync-ip-prefix"

describe("sedPatternForIpPrefix", () => {
  it("escapes an IPv4 prefix for sed and rejects a command suffix", () => {
    expect(sedPatternForIpPrefix("192.168.56")).toBe("192\\.168\\.56")
    expect(sedPatternForIpPrefix("10.0.0.1;touch")).toBeNull()
  })
})
