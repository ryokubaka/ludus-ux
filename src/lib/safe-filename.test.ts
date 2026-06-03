import { describe, expect, it } from "vitest"
import { detectImageType, sanitizeUsername } from "./safe-filename"

describe("sanitizeUsername", () => {
  it("accepts normal Ludus usernames", () => {
    expect(sanitizeUsername("alice")).toBe("alice")
    expect(sanitizeUsername("user_01")).toBe("user_01")
  })

  it("rejects path traversal and odd characters", () => {
    expect(sanitizeUsername("../etc/passwd")).toBeNull()
    expect(sanitizeUsername("..")).toBeNull()
    expect(sanitizeUsername("user/name")).toBeNull()
    expect(sanitizeUsername("")).toBeNull()
  })
})

describe("detectImageType", () => {
  it("detects PNG magic bytes", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectImageType(buf)?.ext).toBe("png")
  })

  it("rejects unknown content", () => {
    expect(detectImageType(Buffer.from("not an image"))).toBeNull()
  })
})
