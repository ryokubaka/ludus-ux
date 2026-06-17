import { describe, expect, it } from "vitest"
import {
  ansibleMessageSummary,
  isCollectionRemoveMisroute,
  ludusSupportsCollectionRemove,
  ludusSupportsSources,
  ludusVersionAtLeast,
} from "./ludus-version"

describe("ludus-version", () => {
  it("compares semver", () => {
    expect(ludusVersionAtLeast("2.2.0", 2, 2, 0)).toBe(true)
    expect(ludusVersionAtLeast("2.1.2", 2, 2, 0)).toBe(false)
    expect(ludusVersionAtLeast("v2.3.1-beta", 2, 2, 0)).toBe(true)
  })

  it("detects collection remove support", () => {
    expect(ludusSupportsCollectionRemove("2.2.0")).toBe(true)
    expect(ludusSupportsCollectionRemove("2.1.2")).toBe(false)
  })

  it("detects sources API support", () => {
    expect(ludusSupportsSources("2.2.0")).toBe(true)
    expect(ludusSupportsSources("2.2.0+7dcbb288")).toBe(true)
    expect(ludusSupportsSources("Ludus Server 2.2.0+7dcbb288 - community")).toBe(true)
    expect(ludusSupportsSources("2.1.2")).toBe(false)
  })

  it("detects install misroute on remove", () => {
    expect(
      isCollectionRemoveMisroute(
        "Nothing to do. All requested collections are already installed.",
        409,
      ),
    ).toBe(true)
  })

  it("summarizes ansible noise", () => {
    const msg = ansibleMessageSummary(
      "[WARNING]: Galaxy cache has world writable access\nNothing to do. All requested collections are already installed.",
    )
    expect(msg).toContain("Collection removal requires Ludus 2.2.0")
  })
})
