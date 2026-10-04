import { describe, expect, it } from "vitest"
import { assembleVisibleSources } from "@/lib/visible-ludus-sources"

const meow = { sourceID: "ryokubaka-ludus-source-meow", name: "Meow" }
const feat = { sourceID: "ryokubaka-ludus-source-meow-feat", name: "Meow feat" }

describe("assembleVisibleSources", () => {
  it("marks an admin's own source published without adding a second copy", () => {
    const rows = assembleVisibleSources(
      [meow, feat],
      [meow, feat],
      new Set(["ryokubaka-ludus-source-meow-feat"]),
      false,
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.sourceID === feat.sourceID)).toMatchObject({
      published: true,
      sharedCatalog: false,
    })
    expect(rows.find((row) => row.sourceID === meow.sourceID)).toMatchObject({
      published: false,
      sharedCatalog: false,
    })
  })

  it("shows a published source to a user who did not register it", () => {
    const rows = assembleVisibleSources([], [meow, feat], new Set([feat.sourceID]), true)
    expect(rows).toEqual([
      { ...feat, published: true, sharedCatalog: true },
    ])
  })

  it("hides an unpublished source from other users", () => {
    const rows = assembleVisibleSources([], [meow], new Set(), true)
    expect(rows).toEqual([])
  })
})
