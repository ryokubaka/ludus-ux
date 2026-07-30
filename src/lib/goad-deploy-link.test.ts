import { describe, expect, it } from "vitest"
import { pickNewGoadInstanceId } from "./goad-deploy-link"

describe("goad-deploy-link", () => {
  it("picks brand-new instance id not in before set", () => {
    const id = pickNewGoadInstanceId(
      [
        { instanceId: "old-a" },
        { instanceId: "new-b" },
      ],
      { rangeId: "alice-GOAD", beforeIds: new Set(["old-a"]) },
    )
    expect(id).toBe("new-b")
  })

  it("prefers instance already tagged with the target rangeId", () => {
    const id = pickNewGoadInstanceId(
      [
        { instanceId: "noise", ludusRangeId: "other" },
        { instanceId: "match", ludusRangeId: "alice-GOAD" },
        { instanceId: "also-new" },
      ],
      { rangeId: "alice-GOAD", beforeIds: new Set(["noise"]) },
    )
    expect(id).toBe("match")
  })

  it("returns null when nothing new", () => {
    const id = pickNewGoadInstanceId([{ instanceId: "only" }], {
      rangeId: "r",
      beforeIds: new Set(["only"]),
    })
    expect(id).toBeNull()
  })
})
