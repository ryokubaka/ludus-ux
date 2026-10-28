import { describe, expect, it } from "vitest"
import { secretsMatch } from "./settings-public"

describe("secretsMatch", () => {
  it("matches equal secrets, a one-character difference does not, and empty expected never matches", () => {
    expect(secretsMatch("same-password", "same-password")).toBe(true)
    expect(secretsMatch("same-password", "same-passworD")).toBe(false)
    expect(secretsMatch("same-password", "")).toBe(false)
  })
})
