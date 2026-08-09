import { describe, expect, it } from "vitest"
import { isVolatileQueryKey, queryKeys } from "@/lib/query-keys"

describe("isVolatileQueryKey", () => {
  it("flags range status and logs", () => {
    expect(isVolatileQueryKey(queryKeys.rangeStatus("u1", "r1"))).toBe(true)
    expect(isVolatileQueryKey(queryKeys.rangeLogHistory("u1", "r1"))).toBe(true)
  })

  it("flags accessible ranges and template build status", () => {
    expect(isVolatileQueryKey(queryKeys.accessibleRangesList("u1"))).toBe(true)
    expect(isVolatileQueryKey(queryKeys.templateStatus("u1"))).toBe(true)
  })

  it("does not flag long-lived catalog queries", () => {
    expect(isVolatileQueryKey(queryKeys.templates("u1"))).toBe(false)
    expect(isVolatileQueryKey(queryKeys.ansible("u1"))).toBe(false)
    expect(isVolatileQueryKey(queryKeys.version("u1"))).toBe(false)
  })
})
