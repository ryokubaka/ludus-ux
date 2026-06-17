import { describe, expect, it } from "vitest"
import { gitCatalogEntryNames } from "@/lib/source-git-catalog"
import type { RepoTreeItem } from "@/lib/template-repo-client"

describe("gitCatalogEntryNames", () => {
  it("lists only directories under blueprints", () => {
    const items: RepoTreeItem[] = [
      { name: "ad-range", type: "tree", path: "blueprints/ad-range" },
      { name: "README.md", type: "blob", path: "blueprints/README.md" },
    ]
    expect(gitCatalogEntryNames(items, "blueprints")).toEqual(["ad-range"])
  })

  it("includes submodule gitlinks under ansible paths", () => {
    const roles: RepoTreeItem[] = [
      { name: "ludus_adcs", type: "blob", path: "ansible/roles/ludus_adcs" },
    ]
    const collections: RepoTreeItem[] = [
      { name: "community.general", type: "blob", path: "ansible/collections/community.general" },
    ]
    expect(gitCatalogEntryNames(roles, "ansible/roles")).toEqual(["ludus_adcs"])
    expect(gitCatalogEntryNames(collections, "ansible/collections")).toEqual(["community.general"])
  })

  it("lists template directories", () => {
    const items: RepoTreeItem[] = [
      { name: "win11-23h2", type: "tree", path: "templates/win11-23h2" },
    ]
    expect(gitCatalogEntryNames(items, "templates")).toEqual(["win11-23h2"])
  })
})
