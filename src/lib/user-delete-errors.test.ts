import { describe, expect, it } from "vitest"
import { formatLudusUserDeleteError } from "./user-delete-errors"

describe("formatLudusUserDeleteError", () => {
  it("detects userdel 'currently used by process' errors", () => {
    const result = formatLudusUserDeleteError(
      "userdel: user alice is currently used by process 1234",
      "alice",
    )
    expect(result.title).toBe("User still has processes on the Ludus host")
    expect(result.description).toContain("alice")
    expect(result.description).toContain("userdel")
  })

  it("detects 'account in use' variant", () => {
    const result = formatLudusUserDeleteError(
      "userdel: account is in use on this host",
      "bob",
    )
    expect(result.title).toBe("User still has processes on the Ludus host")
  })

  it("returns generic error for other failures", () => {
    const result = formatLudusUserDeleteError("some other error happened", "charlie")
    expect(result.title).toBe("Error deleting user")
    expect(result.description).toContain("charlie")
    expect(result.description).toContain("some other error happened")
  })

  it("truncates very long error messages", () => {
    const longError = "x".repeat(3000)
    const result = formatLudusUserDeleteError(longError, "user1")
    expect(result.description.length).toBeLessThan(3000)
    expect(result.description).toContain("…")
  })

  it("handles non-string raw input", () => {
    const result = formatLudusUserDeleteError(12345 as unknown as string, "u")
    expect(result.title).toBe("Error deleting user")
  })
})
