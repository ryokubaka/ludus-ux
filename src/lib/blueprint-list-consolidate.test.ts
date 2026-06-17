import { describe, expect, it } from "vitest"
import { consolidateBlueprintList } from "./blueprint-list-consolidate"
import type { BlueprintListItem } from "./types"

describe("consolidateBlueprintList", () => {
  it("groups source installs by folder slug", () => {
    const rows: BlueprintListItem[] = [
      { id: "ludus-source-bsl/goad", name: "Game of Active Directory (GOAD)", ownerID: "ROOT" },
      {
        id: "badsectorlabs-ludus-source-bsl/goad",
        name: "Game of Active Directory (GOAD)",
        ownerID: "despacito",
      },
      { id: "ludus-source-bsl/ad-elastic-range", name: "AD + Elastic Security Range", ownerID: "ROOT" },
    ]
    const consolidated = consolidateBlueprintList(rows, {
      isAdmin: true,
      sessionUsername: "despacito",
      ludusUserId: "despacito",
    })
    expect(consolidated).toHaveLength(2)
    const goad = consolidated.find((b) => b.typeKey === "goad")
    expect(goad?.aliasCount).toBe(1)
    expect(goad?.aliasIds).toContain("badsectorlabs-ludus-source-bsl/goad")
    expect(goad?.primaryId).toBe("ludus-source-bsl/goad")
    expect(goad?.isSourceCatalog).toBe(true)
  })

  it("keeps custom blueprints without source prefix separate", () => {
    const rows: BlueprintListItem[] = [
      { id: "my-custom-lab", name: "Custom Lab" },
      { id: "ludus-source-bsl/goad", name: "GOAD" },
    ]
    expect(consolidateBlueprintList(rows)).toHaveLength(2)
  })

  it("does not mark user copies of source blueprints as global source", () => {
    const rows: BlueprintListItem[] = [
      { id: "ludus-source-bsl/ad-elastic-range", name: "AD + Elastic", ownerID: "ROOT" },
      {
        id: "badsectorlabs-ludus-source-bsl/ad-elastic-range-copy",
        name: "AD + Elastic Security Range (Copy)",
        ownerID: "alice",
      },
    ]
    const consolidated = consolidateBlueprintList(rows, {
      isAdmin: false,
      sessionUsername: "alice",
      ludusUserId: "alice",
      blueprintOperatorUserId: "admin",
    })
    expect(consolidated).toHaveLength(2)
    const copy = consolidated.find((b) => b.typeKey === "ad-elastic-range-copy")
    expect(copy?.isSourceCatalog).toBe(false)
    const global = consolidated.find((b) => b.typeKey === "ad-elastic-range")
    expect(global?.isSourceCatalog).toBe(true)
  })
})
