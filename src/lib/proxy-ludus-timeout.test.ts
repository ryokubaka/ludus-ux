import { describe, expect, it } from "vitest"
import { getProxyLudusTimeoutMs, LUDUS_USER_PROVISION_TIMEOUT_MS } from "./proxy-ludus-timeout"

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
  it("uses user-provision ceiling for Ludus user lifecycle", () => {
    expect(LUDUS_USER_PROVISION_TIMEOUT_MS).toBe(5 * 60_000)
    expect(getProxyLudusTimeoutMs("/user", "POST")).toBe(LUDUS_USER_PROVISION_TIMEOUT_MS)
    expect(getProxyLudusTimeoutMs("/user/credentials", "POST")).toBe(LUDUS_USER_PROVISION_TIMEOUT_MS)
    expect(getProxyLudusTimeoutMs("/user/apikey", "GET")).toBe(LUDUS_USER_PROVISION_TIMEOUT_MS)
  })
})
