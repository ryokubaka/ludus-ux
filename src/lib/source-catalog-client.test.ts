import { describe, expect, it } from "vitest"
import { sourceCatalogItems } from "@/lib/source-catalog-client"

describe("sourceCatalogItems", () => {
  it("prefers items over legacy segment keys", () => {
    expect(sourceCatalogItems({ items: [{ name: "a" }], roles: [{ name: "b" }] })).toEqual([
      { name: "a" },
    ])
  })

  it("reads legacy roles and collections shapes", () => {
    expect(sourceCatalogItems({ roles: [{ name: "role-a" }] })).toEqual([{ name: "role-a" }])
    expect(sourceCatalogItems({ collections: [{ name: "coll-a" }] })).toEqual([{ name: "coll-a" }])
  })
})
