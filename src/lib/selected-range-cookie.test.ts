import { describe, expect, it } from "vitest"
import {
  decodeSelectedRangeCookie,
  encodeSelectedRangeCookie,
  isValidSelectedRangeId,
  resolveSelectedRangeId,
} from "./selected-range-cookie"

describe("selected-range-cookie", () => {
  it("round-trips scope + rangeId", () => {
    const raw = encodeSelectedRangeCookie("admin|self", "testuser-range")
    expect(decodeSelectedRangeCookie(raw)).toEqual({ s: "admin|self", r: "testuser-range" })
  })

  it("validates ludus-like range ids", () => {
    expect(isValidSelectedRangeId("testuser")).toBe(true)
    expect(isValidSelectedRangeId("bad id")).toBe(false)
  })

  it("resolves cookie when scope matches accessible list", () => {
    const session = { username: "admin", impersonationUserId: undefined }
    const cookie = { s: "admin|self", r: "range-b" }
    const ranges = [
      { rangeNumber: 1, rangeID: "range-a", accessType: "Direct" },
      { rangeNumber: 2, rangeID: "range-b", accessType: "Direct" },
    ]
    expect(resolveSelectedRangeId(session, cookie, ranges)).toBe("range-b")
  })

  it("ignores cookie on scope mismatch and falls back to first range", () => {
    const session = { username: "admin", impersonationUserId: "testuser" }
    const cookie = { s: "admin|self", r: "range-b" }
    const ranges = [{ rangeNumber: 1, rangeID: "range-a", accessType: "Direct" }]
    expect(resolveSelectedRangeId(session, cookie, ranges)).toBe("range-a")
  })
})
