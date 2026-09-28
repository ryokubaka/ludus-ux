import { describe, expect, it } from "vitest"
import {
  buildHostProbeCmd,
  buildStartUpgradeCmd,
  isSafeLuxRepoPath,
  parseHostProbe,
} from "./lux-upgrade-host"

describe("lux-upgrade-host", () => {
  it("accepts absolute host paths and rejects injection", () => {
    expect(isSafeLuxRepoPath("/opt/ludus-ux")).toBe(true)
    expect(isSafeLuxRepoPath("/home/user/ludus-ux")).toBe(true)
    expect(isSafeLuxRepoPath("ludus-ux")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/../etc")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/ludus-ux;rm -rf /")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/ludus-ux$(id)")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/ludus-ux\n/tmp")).toBe(false)
  })

  it("quotes the explicit repo path in the probe command", () => {
    const cmd = buildHostProbeCmd("/opt/ludus-ux")
    expect(cmd.startsWith("PROVIDED='/opt/ludus-ux'")).toBe(true)
    expect(cmd).not.toContain("PROVIDED=/opt/ludus-ux;")
  })

  it("parses a ready host probe", () => {
    const cap = parseHostProbe(
      [
        "repo=/opt/ludus-ux",
        "compose=yes",
        "script=yes",
        "git=yes",
        "dirty=no",
        "checkout=v1.3.2",
        "ok=yes",
      ].join("\n"),
    )
    expect(cap).toEqual({
      canSwitch: true,
      repoPath: "/opt/ludus-ux",
      dirty: false,
      checkout: "v1.3.2",
      reason: null,
    })
  })

  it("rejects a missing or unsafe repo from probe output", () => {
    const missing = parseHostProbe("repo=\nok=no\nreason=not_found\n")
    expect(missing.canSwitch).toBe(false)
    expect(missing.repoPath).toBeNull()

    const injected = parseHostProbe("repo=/opt/ludus-ux;rm -rf /\ncompose=yes\nscript=yes\ngit=yes\n")
    expect(injected.canSwitch).toBe(false)
    expect(injected.repoPath).toBeNull()
  })

  it("builds a quoted background upgrade command", () => {
    const cmd = buildStartUpgradeCmd("/opt/ludus-ux", "v1.3.3")
    expect(cmd).toContain("REPO='/opt/ludus-ux'")
    expect(cmd).toContain("TAG='v1.3.3'")
    expect(cmd).toContain("LUX_UPGRADE_YES=1")
    expect(cmd).toContain("LUX_UPGRADE_EXIT:$?")
    expect(cmd).toContain("scripts/upgrade.sh")
    expect(cmd).not.toContain("v1.3.3;rm")
    expect(cmd).not.toContain("&;")
    expect(cmd).toContain("& echo started")
  })

  it("refuses to start an upgrade with a bad tag or path", () => {
    expect(() => buildStartUpgradeCmd("/opt/ludus-ux", "v1.3.3;rm")).toThrow("Invalid release tag")
    expect(() => buildStartUpgradeCmd("/opt/ludus-ux", "main")).toThrow("Invalid release tag")
    expect(() => buildStartUpgradeCmd("/opt/../tmp", "v1.3.3")).toThrow("Unsafe repository path")
  })
})
