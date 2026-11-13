import { describe, expect, it } from "vitest"
import { blueprintPaletteFromSources } from "./builder-blueprints"

describe("blueprint palette from sources", () => {
  it("lists source blueprints and keeps a host-only blueprint separate", () => {
    const items = blueprintPaletteFromSources(
      [
        {
          sourceId: "ludus-source-bsl",
          sourceLabel: "badsectorlabs",
          items: [
            { name: "Labyrinth", description: "A maze", sourceBlueprintID: "ludus-source-bsl/labyrinth" },
            { name: "SCCM", description: "SCCM lab" },
          ],
        },
      ],
      [
        { id: "ludus-source-bsl/labyrinth", name: "Labyrinth", description: "installed copy" },
        { id: "my-custom", name: "My custom", description: "saved from a range" },
      ],
    )
    expect(items.map((item) => item.name)).toEqual(["Labyrinth", "SCCM", "My custom"])
    expect(items[0]).toMatchObject({
      id: "ludus-source-bsl/labyrinth",
      sourceId: "ludus-source-bsl",
      installName: "labyrinth",
      installedId: "ludus-source-bsl/labyrinth",
    })
    expect(items[1]).toMatchObject({
      sourceId: "ludus-source-bsl",
      installName: "SCCM",
      installedId: undefined,
      id: "ludus-source-bsl/SCCM",
    })
    expect(items[2]).toMatchObject({ sourceLabel: "On this host", id: "my-custom" })
  })
})