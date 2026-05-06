import { describe, expect, it } from "vitest"
import {
  classifySnapshotMutation,
  firstSnapshotMutationErrorMessage,
  ludusSnapshotByNameBody,
  ludusSnapshotCreateBody,
  snapshotsRangeQuery,
} from "./ludus-snapshot-payload"

describe("snapshotsRangeQuery", () => {
  it("encodes range id", () => {
    expect(snapshotsRangeQuery("DEMO/r1")).toBe(`?rangeID=${encodeURIComponent("DEMO/r1")}`)
  })
  it("empty for blank or undefined", () => {
    expect(snapshotsRangeQuery("  ")).toBe("")
    expect(snapshotsRangeQuery(undefined)).toBe("")
  })
})

describe("ludusSnapshotCreateBody", () => {
  it("maps snapshotName to name", () => {
    expect(ludusSnapshotCreateBody({ snapshotName: "s1" })).toEqual({ name: "s1" })
  })
  it("includes optional fields", () => {
    expect(
      ludusSnapshotCreateBody({
        snapshotName: "s1",
        description: "d",
        includeRAM: false,
        vmids: [1, 2],
      }),
    ).toEqual({ name: "s1", description: "d", includeRAM: false, vmids: [1, 2] })
  })
  it("omits empty vmids", () => {
    expect(ludusSnapshotCreateBody({ snapshotName: "s1", vmids: [] })).not.toHaveProperty("vmids")
  })
})

describe("ludusSnapshotByNameBody", () => {
  it("uses Ludus name field", () => {
    expect(ludusSnapshotByNameBody({ snapshotName: "x" })).toEqual({ name: "x" })
  })
})

describe("classifySnapshotMutation", () => {
  it("ok when no errors", () => {
    expect(classifySnapshotMutation({ success: [1], errors: [] })).toBe("ok")
    expect(classifySnapshotMutation({ success: [1] })).toBe("ok")
    expect(classifySnapshotMutation(undefined)).toBe("ok")
  })
  it("fail when only errors", () => {
    expect(classifySnapshotMutation({ errors: [{ error: "e" }] })).toBe("fail")
  })
  it("partial when both", () => {
    expect(classifySnapshotMutation({ success: [1], errors: [{ error: "e" }] })).toBe("partial")
  })
})

describe("firstSnapshotMutationErrorMessage", () => {
  it("returns first error text", () => {
    expect(firstSnapshotMutationErrorMessage({ errors: [{ error: "bad" }] })).toBe("bad")
  })
  it("null when no errors", () => {
    expect(firstSnapshotMutationErrorMessage({ success: [1] })).toBeNull()
  })
})
