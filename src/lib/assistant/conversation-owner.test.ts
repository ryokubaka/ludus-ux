import { describe, expect, it } from "vitest"
import { assistantConversationOwner } from "./conversation-owner"

describe("assistantConversationOwner", () => {
  it("uses the logged-in user when not impersonating", () => {
    expect(
      assistantConversationOwner({
        username: "user-self",
        impersonationUserId: null,
        impersonationLudusUserId: null,
      }),
    ).toBe("user-self")
  })

  it("scopes to the impersonation target, not the admin", () => {
    expect(
      assistantConversationOwner({
        username: "admin-user",
        impersonationUserId: "target-user",
        impersonationLudusUserId: "target-ludus-id",
      }),
    ).toBe("target-ludus-id")
  })

  it("falls back to impersonationUserId when ludus id missing", () => {
    expect(
      assistantConversationOwner({
        username: "admin-user",
        impersonationUserId: "target-user",
      }),
    ).toBe("target-user")
  })
})
