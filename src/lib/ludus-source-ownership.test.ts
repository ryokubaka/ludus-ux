import { describe, expect, it } from "vitest"
import {
  buildRepairLudusSourcesOwnershipCmd,
  isLudusSourceGitPermissionError,
} from "./ludus-source-ownership"

describe("isLudusSourceGitPermissionError", () => {
  it("matches Ludus fetch permission failure", () => {
    const msg =
      "git [-C /opt/ludus/sources/abc123source fetch --depth 1 origin main] failed: " +
      "error: insufficient permission for adding an object to repository database .git/objects; " +
      "fatal: failed to write object; fatal: unpack-objects failed: exit status 128"
    expect(isLudusSourceGitPermissionError(msg)).toBe(true)
  })

  it("ignores unrelated sync errors", () => {
    expect(isLudusSourceGitPermissionError("pathspec 'main' did not match")).toBe(false)
    expect(isLudusSourceGitPermissionError("authentication failed")).toBe(false)
  })
})

describe("buildRepairLudusSourcesOwnershipCmd", () => {
  it("chowns all sources by default", () => {
    const cmd = buildRepairLudusSourcesOwnershipCmd("/opt/ludus")
    expect(cmd).toContain("TARGET='/opt/ludus/sources'")
    expect(cmd).toContain('chown -R ludus:ludus "$TARGET"')
    expect(cmd).toContain("find \"$TARGET\" -type d -exec chmod u+rwx {} +")
  })

  it("scopes to one clone dir when id provided", () => {
    const cmd = buildRepairLudusSourcesOwnershipCmd("/opt/ludus", "abc123source")
    expect(cmd).toContain("TARGET='/opt/ludus/sources/abc123source'")
  })

  it("strips unsafe characters from clone dir id", () => {
    const cmd = buildRepairLudusSourcesOwnershipCmd("/opt/ludus", "../evil;rm")
    expect(cmd).toContain("TARGET='/opt/ludus/sources/evilrm'")
    expect(cmd).not.toContain("..")
    expect(cmd).not.toContain(";")
  })
})
