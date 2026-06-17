import { describe, expect, it } from "vitest"
import { parseGalaxyCollectionHits, parseGalaxyRoleHits, groupGalaxySearchHits, compareGalaxyVersionDesc } from "./ansible-galaxy-search"

describe("ansible-galaxy-search", () => {
  it("parses Galaxy v1 role search hits", () => {
    const items = parseGalaxyRoleHits([
      {
        username: "geerlingguy",
        name: "nginx",
        summary: "Nginx role",
        summary_fields: { versions: [{ name: "1.2.3" }] },
      },
    ])
    expect(items).toEqual([
      {
        name: "geerlingguy.nginx",
        version: "1.2.3",
        type: "role",
        description: "Nginx role",
        downloadCount: undefined,
      },
    ])
  })

  it("parses Galaxy v3 collection search hits", () => {
    const items = parseGalaxyCollectionHits([
      {
        collection_version: {
          namespace: "ansible",
          name: "windows",
          version: "2.0.0",
          description: "Windows modules",
        },
      },
    ])
    expect(items[0]?.name).toBe("ansible.windows")
    expect(items[0]?.version).toBe("2.0.0")
  })

  it("groups collection versions into one row sorted newest first", () => {
    const grouped = groupGalaxySearchHits([
      { name: "ansible.windows", version: "2.8.0", type: "collection" },
      { name: "ansible.windows", version: "3.6.1", type: "collection" },
      { name: "ansible.windows", version: "3.0.0", type: "collection" },
      { name: "community.general", version: "10.0.0", type: "collection" },
    ])
    expect(grouped).toHaveLength(2)
    const win = grouped.find((g) => g.name === "ansible.windows")
    expect(win?.versions).toEqual(["3.6.1", "3.0.0", "2.8.0"])
  })

  it("sorts semver versions descending", () => {
    expect(compareGalaxyVersionDesc("3.6.1", "3.0.0")).toBeLessThan(0)
    expect(compareGalaxyVersionDesc("2.8.0", "3.0.0")).toBeGreaterThan(0)
  })
})
