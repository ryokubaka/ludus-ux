import { describe, expect, it } from "vitest"
import { mergeUsersByUserId, normalizeLudusUserList } from "./ludus-share-picker-users"

describe("normalizeLudusUserList", () => {
  it("unwraps result arrays", () => {
    const list = normalizeLudusUserList({
      result: [{ userID: "alice", isAdmin: false }],
    })
    expect(list).toHaveLength(1)
    expect(list[0]?.userID).toBe("alice")
  })
})

describe("mergeUsersByUserId", () => {
  it("dedupes and drops ROOT", () => {
    const merged = mergeUsersByUserId([
      { userID: "alice", isAdmin: false, name: "Alice" },
      { userID: "alice", isAdmin: false },
      { userID: "ROOT", isAdmin: true },
      { userID: "bob", isAdmin: false },
    ])
    expect(merged.map((u) => u.userID)).toEqual(["alice", "bob"])
  })
})
