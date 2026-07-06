import { describe, expect, it } from "vitest"
import { ludusImpersonationFields, ludusCallerFromGetUser } from "./ludus-user-from-profile"

describe("ludusImpersonationFields", () => {
  it("returns all fields from a full user", () => {
    const result = ludusImpersonationFields({
      userID: "user-123",
      name: "alice",
      proxmoxUsername: "pve-alice",
    })
    expect(result.ludusUserId).toBe("user-123")
    expect(result.ludusPrincipal).toBe("alice")
    expect(result.sshLogin).toBe("pve-alice")
  })

  it("falls back to name for sshLogin when proxmoxUsername is empty", () => {
    const result = ludusImpersonationFields({
      userID: "uid",
      name: "bob",
      proxmoxUsername: "",
    })
    expect(result.sshLogin).toBe("bob")
  })

  it("falls back to userID for sshLogin when name is not POSIX-safe", () => {
    const result = ludusImpersonationFields({
      userID: "uid",
      name: "Bob Smith",
      proxmoxUsername: "",
    })
    expect(result.sshLogin).toBe("uid")
  })

  it("uses userID as ludusPrincipal when name is empty", () => {
    const result = ludusImpersonationFields({
      userID: "uid",
      name: "",
      proxmoxUsername: "",
    })
    expect(result.ludusPrincipal).toBe("uid")
  })
})

describe("ludusCallerFromGetUser", () => {
  it("returns user from single-element array", () => {
    const raw = [{ userID: "uid1", name: "alice", isAdmin: false }]
    const result = ludusCallerFromGetUser(raw, "")
    expect(result?.userId).toBe("uid1")
  })

  it("matches by loginHint in multi-user array", () => {
    const raw = [
      { userID: "uid1", name: "alice", isAdmin: false },
      { userID: "uid2", name: "bob", isAdmin: false },
    ]
    const result = ludusCallerFromGetUser(raw, "bob")
    expect(result?.userId).toBe("uid2")
  })

  it("matches by userID", () => {
    const raw = [
      { userID: "uid1", name: "alice", isAdmin: false },
      { userID: "uid2", name: "bob", isAdmin: false },
    ]
    const result = ludusCallerFromGetUser(raw, "uid1")
    expect(result?.userId).toBe("uid1")
  })

  it("matches by proxmoxUsername", () => {
    const raw = [
      { userID: "uid1", name: "alice", isAdmin: false, proxmoxUsername: "pve-alice" },
    ]
    const result = ludusCallerFromGetUser(raw, "pve-alice")
    expect(result?.userId).toBe("uid1")
  })

  it("unwraps { result: [...] } envelope", () => {
    const raw = { result: [{ userID: "uid1", name: "alice", isAdmin: false }] }
    const result = ludusCallerFromGetUser(raw, "")
    expect(result?.userId).toBe("uid1")
  })

  it("returns undefined for empty list", () => {
    expect(ludusCallerFromGetUser([], "alice")).toBeUndefined()
  })

  it("returns undefined for multi-user without loginHint", () => {
    const raw = [
      { userID: "uid1", name: "alice", isAdmin: false },
      { userID: "uid2", name: "bob", isAdmin: false },
    ]
    expect(ludusCallerFromGetUser(raw, "")).toBeUndefined()
  })
})
