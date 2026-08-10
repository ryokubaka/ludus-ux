import { describe, expect, it } from "vitest"
import {
  needsImpersonationForRangeOwner,
  normalizeLudusUserId,
  resolveOwnerUser,
} from "./navigate-to-range-dashboard"
import type { UserObject } from "./types"

describe("navigate-to-range-dashboard", () => {
  it("normalizeLudusUserId is case-insensitive", () => {
    expect(normalizeLudusUserId(" CatShadowstep ")).toBe("catshadowstep")
  })

  it("needsImpersonationForRangeOwner when owner differs from operator", () => {
    expect(needsImpersonationForRangeOwner("alice", "bob")).toBe(true)
    expect(needsImpersonationForRangeOwner("Alice", "alice")).toBe(false)
    expect(needsImpersonationForRangeOwner("", "alice")).toBe(false)
    expect(needsImpersonationForRangeOwner("alice", null)).toBe(false)
  })

  it("resolveOwnerUser finds user by userID", () => {
    const users: UserObject[] = [
      { userID: "catshadowstep", name: "Cat", proxmoxUsername: "cat" },
      { userID: "other", name: "Other", proxmoxUsername: "other" },
    ]
    expect(resolveOwnerUser(users, "catshadowstep")?.name).toBe("Cat")
    expect(resolveOwnerUser(users, "missing")).toBeNull()
  })
})
