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
    expect(buildRepairLudusSourcesOwnershipCmd("/opt/ludus")).toEqual(["sources-repair"])
  })

  it("scopes to one clone dir when id provided", () => {
    expect(buildRepairLudusSourcesOwnershipCmd("/opt/ludus", "abc123source")).toEqual([
      "sources-repair",
      "abc123source",
    ])
  })

  it("strips unsafe characters from clone dir id", () => {
    expect(buildRepairLudusSourcesOwnershipCmd("/opt/ludus", "../evil;rm")).toEqual([
      "sources-repair",
      "evilrm",
    ])
  })
})
