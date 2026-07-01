import { describe, expect, it } from "vitest"
import {
  parseBlueprintBulkErrors,
  parseBlueprintBulkSuccess,
  blueprintBulkHadFailures,
} from "./blueprint-bulk-response"

describe("parseBlueprintBulkErrors", () => {
  it("reads top-level errors", () => {
    expect(
      parseBlueprintBulkErrors({
        success: ["alice"],
        errors: [{ item: "bob", reason: "denied" }],
      }),
    ).toEqual([{ item: "bob", reason: "denied" }])
  })

  it("unwraps result envelope", () => {
    expect(
      parseBlueprintBulkErrors({
        result: {
          errors: [{ item: "bob", reason: "not owner" }],
        },
      }),
    ).toEqual([{ item: "bob", reason: "not owner" }])
  })

  it("reads results array with ok false", () => {
    expect(
      parseBlueprintBulkErrors({
        results: [
          { ok: true, item: "alice" },
          { ok: false, item: "bob", reason: "forbidden" },
        ],
      }),
    ).toEqual([{ item: "bob", reason: "forbidden" }])
  })

  it("skips results with ok: true", () => {
    const data = { results: [{ ok: true, item: "bp3" }] }
    expect(parseBlueprintBulkErrors(data)).toEqual([])
  })

  it("returns [] for null input", () => {
    expect(parseBlueprintBulkErrors(null)).toEqual([])
  })

  it("returns [] for non-object input", () => {
    expect(parseBlueprintBulkErrors("string")).toEqual([])
  })

  it("skips error entries without item", () => {
    const data = { errors: [{ reason: "no item field" }] }
    expect(parseBlueprintBulkErrors(data)).toEqual([])
  })
})

describe("parseBlueprintBulkSuccess", () => {
  it("unwraps result success list", () => {
    expect(
      parseBlueprintBulkSuccess({
        result: { success: ["alice", "bob"] },
      }),
    ).toEqual(["alice", "bob"])
  })

  it("extracts top-level success array", () => {
    expect(parseBlueprintBulkSuccess({ success: ["bp1", "bp2"] })).toEqual(["bp1", "bp2"])
  })

  it("returns [] when no success key", () => {
    expect(parseBlueprintBulkSuccess({ errors: [] })).toEqual([])
  })

  it("returns [] for null", () => {
    expect(parseBlueprintBulkSuccess(null)).toEqual([])
  })

  it("filters out empty strings", () => {
    expect(parseBlueprintBulkSuccess({ success: ["bp1", "", "bp2"] })).toEqual(["bp1", "bp2"])
  })
})

describe("blueprintBulkHadFailures", () => {
  it("returns true when errors exist", () => {
    expect(blueprintBulkHadFailures({ errors: [{ item: "x", reason: "y" }] })).toBe(true)
  })

  it("returns false when no errors", () => {
    expect(blueprintBulkHadFailures({ success: ["bp1"] })).toBe(false)
  })
})
