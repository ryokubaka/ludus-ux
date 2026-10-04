import { describe, expect, it } from "vitest"
import { mergeSourceTemplateRows } from "@/lib/source-catalog-resolver"

describe("mergeSourceTemplateRows", () => {
  it("keeps every git template when Ludus only knows the installed one", () => {
    const merged = mergeSourceTemplateRows(
      [{ name: "ubuntu-24.04-x64-server-template", version: "1.0.0" }],
      [
        { name: "ubuntu-24.04-x64-server-template", path: "templates/ubuntu-24.04-x64-server" },
        { name: "debian-13-x64-server-template", path: "templates/debian13" },
        { name: "win2019-server-x64-template", path: "templates/win2019-server-x64" },
      ],
    )
    expect(merged.map((row) => row.name)).toEqual([
      "debian-13-x64-server-template",
      "ubuntu-24.04-x64-server-template",
      "win2019-server-x64-template",
    ])
    expect(merged.find((row) => row.name === "ubuntu-24.04-x64-server-template")).toMatchObject({
      version: "1.0.0",
      path: "templates/ubuntu-24.04-x64-server",
    })
    expect(merged.find((row) => row.name === "debian-13-x64-server-template")?.path).toBe(
      "templates/debian13",
    )
  })

  it("matches install names without regard to case", () => {
    const merged = mergeSourceTemplateRows(
      [{ name: "Debian-13-x64-server-template" }],
      [{ name: "debian-13-x64-server-template", path: "templates/debian13" }],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.path).toBe("templates/debian13")
  })
})
