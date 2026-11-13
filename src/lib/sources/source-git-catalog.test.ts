import { describe, expect, it } from "vitest"
import {
  directGitChildren,
  gitCatalogEntryNames,
  parseAnsibleRoleVersionYaml,
  roleMetaVersionPath,
  templatePackerPath,
} from "@/lib/sources/source-git-catalog"
import type { RepoTreeItem } from "@/lib/templates/template-repo-client"

describe("parseAnsibleRoleVersionYaml", () => {
  it("reads meta/version.yml", () => {
    expect(parseAnsibleRoleVersionYaml("version: 1.0.0\n")).toBe("1.0.0")
    expect(parseAnsibleRoleVersionYaml("version: 1.0.0")).toBe("1.0.0")
  })

  it("reads galaxy_info.version from meta/main.yml", () => {
    expect(
      parseAnsibleRoleVersionYaml(
        ["galaxy_info:", "  role_name: ludus_securityonion", '  version: "1.0.0"', ""].join("\n"),
      ),
    ).toBe("1.0.0")
  })
})

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
      { name: "ludus_adfs", type: "commit", path: "ansible/roles/ludus_adfs" },
    ]
    const collections: RepoTreeItem[] = [
      { name: "community.general", type: "commit", path: "ansible/collections/community.general" },
    ]
    expect(gitCatalogEntryNames(roles, "ansible/roles")).toEqual(["ludus_adcs", "ludus_adfs"])
    expect(gitCatalogEntryNames(collections, "ansible/collections")).toEqual(["community.general"])
  })

  it("reads one recursive tree down to the files a catalog needs", () => {
    const tree: RepoTreeItem[] = [
      { name: "blueprints", type: "tree", path: "blueprints" },
      { name: "ad-range", type: "tree", path: "blueprints/ad-range" },
      { name: "blueprint.yml", type: "blob", path: "blueprints/ad-range/blueprint.yml" },
      { name: "debian13", type: "tree", path: "templates/debian13" },
      { name: "debian13.pkr.hcl", type: "blob", path: "templates/debian13/debian13.pkr.hcl" },
      { name: "nested", type: "blob", path: "templates/debian13/http/extra.pkr.hcl" },
      { name: "ludus_adcs", type: "tree", path: "ansible/roles/ludus_adcs" },
      { name: "version.yml", type: "blob", path: "ansible/roles/ludus_adcs/meta/version.yml" },
      { name: "main.yml", type: "blob", path: "ansible/roles/other/meta/main.yml" },
    ]
    expect(directGitChildren(tree, "blueprints").map((item) => item.name)).toEqual(["ad-range"])
    expect(templatePackerPath(tree, "debian13")).toBe("templates/debian13/debian13.pkr.hcl")
    expect(roleMetaVersionPath(tree, "ludus_adcs")).toBe("ansible/roles/ludus_adcs/meta/version.yml")
    expect(roleMetaVersionPath(tree, "other")).toBe("ansible/roles/other/meta/main.yml")
    expect(roleMetaVersionPath(tree, "missing")).toBeNull()
  })

  it("lists template directories", () => {
    const items: RepoTreeItem[] = [
      { name: "win11-23h2", type: "tree", path: "templates/win11-23h2" },
    ]
    expect(gitCatalogEntryNames(items, "templates")).toEqual(["win11-23h2"])
  })
})
