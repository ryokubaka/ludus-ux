import { describe, expect, it } from "vitest"
import { rangeCreateKeys, rangeCreateNeedsAdminKey } from "@/lib/luxai/range-create-auth"

describe("range create auth", () => {
  it("tries the user key, then the root key when they differ", () => {
    expect(rangeCreateKeys("user-key", "root-key")).toEqual(["user-key", "root-key"])
    expect(rangeCreateKeys("same", "same")).toEqual(["same"])
    expect(rangeCreateKeys("", "root-key")).toEqual(["root-key"])
  })

  it("treats the admin-only refusal as a reason to try the next key", () => {
    expect(rangeCreateNeedsAdminKey("You must be an admin to use this endpoint", 403)).toBe(true)
    expect(rangeCreateNeedsAdminKey("range id already exists", 409)).toBe(false)
  })
})
