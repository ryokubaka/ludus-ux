import { afterEach, describe, expect, it, vi } from "vitest"
import { safeClientError } from "./safe-client-error"

describe("safeClientError", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns original message in development", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(safeClientError(new Error("internal detail"))).toBe("internal detail")
  })

  it("returns fallback in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(safeClientError(new Error("internal detail"), "Request failed")).toBe(
      "Request failed",
    )
  })
})
