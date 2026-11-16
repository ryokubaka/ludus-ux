import { describe, expect, it } from "vitest"
import { changelogVersionKey, parseChangelog } from "@/components/settings/changelog-notes"

describe("changelog notes", () => {
  it("matches a release tag to its changelog version", () => {
    const versions = parseChangelog([
      "## [1.6.2] - 2026-11-16",
      "",
      "**LUX**",
      "",
      "- [Fix] **Ludus upgrade** — The package URL keeps its host.",
      "",
      "## [1.6.1] - 2026-11-16",
      "",
      "- [Improve] **Range Builder GOAD** — Labs draw on the canvas.",
    ].join("\n"))
    expect(versions.map((version) => changelogVersionKey(version.title))).toEqual(["1.6.2", "1.6.1"])
    expect(changelogVersionKey("v1.6.2")).toBe("1.6.2")
    expect(versions[0]?.groups[0]?.entries[0]?.tag).toBe("fix")
  })
})