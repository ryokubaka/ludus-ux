import { describe, expect, it } from "vitest"
import {
  ansibleMessageSummary,
  isCollectionRemoveMisroute,
  ludusMayIgnoreDeployVerboseWhenForce,
  ludusSupportsCollectionRemove,
  ludusSupportsExtensionsKey,
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

  it("detects ludus_extensions key support (2.3.0+)", () => {
    expect(ludusSupportsExtensionsKey("2.3.0")).toBe(true)
    expect(ludusSupportsExtensionsKey("2.3.1")).toBe(true)
    expect(ludusSupportsExtensionsKey("2.2.4")).toBe(false)
    expect(ludusSupportsExtensionsKey("Ludus Server 2.3.0+abc - community")).toBe(true)
  })

  it("flags deploy verbose+force quirk on Ludus ≤2.2.3", () => {
    expect(ludusMayIgnoreDeployVerboseWhenForce("2.2.3")).toBe(true)
    expect(ludusMayIgnoreDeployVerboseWhenForce("2.2.4")).toBe(false)
    expect(ludusMayIgnoreDeployVerboseWhenForce("2.3.0")).toBe(false)
    expect(ludusMayIgnoreDeployVerboseWhenForce("")).toBe(true)
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
