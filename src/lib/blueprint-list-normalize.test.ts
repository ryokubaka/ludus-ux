import { describe, expect, it } from "vitest"
import {
  isGlobalSourceCatalogBlueprint,
  isLikelyUserBlueprintCopy,
  isSourceCatalogBlueprintId,
  normalizeBlueprintList,
  normalizeBlueprintListItem,
} from "./blueprint-list-normalize"

describe("normalizeBlueprintListItem", () => {
  it("maps Ludus v2 owner and shared user arrays", () => {
    const bp = normalizeBlueprintListItem({
      blueprintID: "ludus-source-bsl/goad",
      name: "GOAD",
      ownerUserID: "ROOT",
      accessType: "owner",
      sharedUsers: ["alice", "bob"],
      sharedGroups: ["red-team"],
      updated: "2026-06-16T18:00:00Z",
    })
    expect(bp?.id).toBe("ludus-source-bsl/goad")
    expect(bp?.ownerID).toBe("ROOT")
    expect(bp?.access).toBe("owner")
    expect(bp?.sharedUsers).toBe(2)
    expect(bp?.sharedUserIds).toEqual(["alice", "bob"])
    expect(bp?.sharedGroups).toBe(1)
    expect(bp?.sharedGroupNames).toEqual(["red-team"])
  })
})

describe("normalizeBlueprintList", () => {
  it("unwraps result arrays", () => {
    const list = normalizeBlueprintList({
      result: [{ blueprintID: "my-lab", name: "Lab" }],
    })
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe("my-lab")
  })
})

describe("isSourceCatalogBlueprintId", () => {
  it("detects source slug ids", () => {
    expect(isSourceCatalogBlueprintId("ludus-source-bsl/goad")).toBe(true)
    expect(isSourceCatalogBlueprintId("my-custom-lab")).toBe(false)
  })
})

describe("isLikelyUserBlueprintCopy", () => {
  it("detects Ludus copy suffix and name", () => {
    expect(
      isLikelyUserBlueprintCopy({
        id: "badsectorlabs-ludus-source-bsl/ad-elastic-range-copy",
        name: "AD + Elastic Security Range (Copy)",
        ownerID: "alice",
      }),
    ).toBe(true)
  })

  it("does not treat global install with non-ROOT owner as copy", () => {
    expect(
      isLikelyUserBlueprintCopy({
        id: "badsectorlabs-ludus-source-bsl/goad",
        name: "Game of Active Directory (GOAD)",
        ownerID: "despacito",
      }),
    ).toBe(false)
  })
})

describe("isGlobalSourceCatalogBlueprint", () => {
  it("excludes user copies from global source", () => {
    expect(
      isGlobalSourceCatalogBlueprint({
        id: "badsectorlabs-ludus-source-bsl/ad-elastic-range-copy",
        name: "AD + Elastic Security Range (Copy)",
        ownerID: "alice",
      }),
    ).toBe(false)
    expect(
      isGlobalSourceCatalogBlueprint({
        id: "ludus-source-bsl/ad-elastic-range",
        ownerID: "ROOT",
      }),
    ).toBe(true)
    expect(
      isGlobalSourceCatalogBlueprint({
        id: "badsectorlabs-ludus-source-bsl/goad",
        name: "Game of Active Directory (GOAD)",
        ownerID: "despacito",
      }),
    ).toBe(true)
  })
})
