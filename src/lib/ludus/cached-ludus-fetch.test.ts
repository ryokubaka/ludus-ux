import { describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}))

import { ludusCachePartition } from "@/lib/ludus/cached-ludus-fetch"

describe("ludusCachePartition", () => {
  it("is stable for the same key and scope", () => {
    expect(ludusCachePartition("secret-api-key", "alice|self")).toBe(
      ludusCachePartition("secret-api-key", "alice|self"),
    )
  })

  it("separates different API keys and scopes", () => {
    const base = ludusCachePartition("key-a", "alice|self")
    expect(ludusCachePartition("key-b", "alice|self")).not.toBe(base)
    expect(ludusCachePartition("key-a", "alice|user-bob")).not.toBe(base)
  })

  it("does not expose the raw API key in the cache key", () => {
    const partition = ludusCachePartition("super-secret-token", "alice|self")
    expect(partition).not.toContain("super-secret-token")
    expect(partition.startsWith("alice|self:")).toBe(true)
    expect(partition.split(":")[1]).toMatch(/^[0-9a-f]{16}$/)
  })
})
