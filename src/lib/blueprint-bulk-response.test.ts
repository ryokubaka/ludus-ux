import { describe, expect, it } from "vitest"
import {
  parseBlueprintBulkErrors,
  parseBlueprintBulkSuccess,
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
})

describe("parseBlueprintBulkSuccess", () => {
  it("unwraps result success list", () => {
    expect(
      parseBlueprintBulkSuccess({
        result: { success: ["alice", "bob"] },
      }),
    ).toEqual(["alice", "bob"])
  })
})
