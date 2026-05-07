import { describe, expect, it } from "vitest"
import { getProxyLudusTimeoutMs } from "./proxy-ludus-timeout"

describe("getProxyLudusTimeoutMs", () => {
  it("uses very slow for deploy and snapshots", () => {
    expect(getProxyLudusTimeoutMs("/range/deploy", "POST")).toBe(5 * 60_000)
    expect(getProxyLudusTimeoutMs("/snapshots/create", "POST")).toBe(5 * 60_000)
  })
  it("uses slow for ansible inventory GET", () => {
    expect(getProxyLudusTimeoutMs("/range/ansibleinventory", "GET")).toBe(120_000)
  })
  it("defaults for ordinary GET", () => {
    expect(getProxyLudusTimeoutMs("/user", "GET")).toBe(30_000)
  })
})
