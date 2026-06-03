import { afterEach, describe, expect, it } from "vitest"
import { checkRateLimit, resetRateLimit } from "./rate-limit"

describe("checkRateLimit", () => {
  afterEach(() => resetRateLimit())

  it("allows requests under the limit", () => {
    const key = "test:1"
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true)
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true)
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true)
  })

  it("blocks after max attempts", () => {
    const key = "test:2"
    checkRateLimit(key, 2, 60_000)
    checkRateLimit(key, 2, 60_000)
    const blocked = checkRateLimit(key, 2, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })
})
