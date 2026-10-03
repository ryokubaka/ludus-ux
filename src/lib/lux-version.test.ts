import { describe, expect, it } from "vitest"
import {
  buildLuxReleasesSnapshot,
  compareLuxSemver,
  excerptReleaseNotes,
  isLuxReleaseTag,
  losesVersionManagement,
  luxUpgradeFailureFromLog,
  luxVersionRelation,
  parseLuxSemver,
  validateLuxSwitchTag,
} from "./lux-version"

describe("lux-version", () => {
  it("parses v-prefixed and bare semver", () => {
    expect(parseLuxSemver("1.3.2")).toEqual({ major: 1, minor: 3, patch: 2 })
    expect(parseLuxSemver("v1.3.3")).toEqual({ major: 1, minor: 3, patch: 3 })
    expect(parseLuxSemver("v1.3.3-beta")).toBeNull()
    expect(parseLuxSemver("main")).toBeNull()
  })

  it("compares semver numerically", () => {
    const a = parseLuxSemver("1.9.9")!
    const b = parseLuxSemver("1.10.0")!
    expect(compareLuxSemver(a, b)).toBe(-1)
    expect(compareLuxSemver(b, a)).toBe(1)
    expect(compareLuxSemver(a, parseLuxSemver("1.9.9")!)).toBe(0)
  })

  it("accepts only strict vX.Y.Z tags", () => {
    expect(isLuxReleaseTag("v1.3.3")).toBe(true)
    expect(isLuxReleaseTag("1.3.3")).toBe(false)
    expect(isLuxReleaseTag("v1.3.3;rm")).toBe(false)
    expect(isLuxReleaseTag("v1.3.3-rc1")).toBe(false)
    expect(isLuxReleaseTag("main")).toBe(false)
  })

  it("flags downgrades below the version-management floor", () => {
    expect(losesVersionManagement("v1.4.0")).toBe(false)
    expect(losesVersionManagement("v1.4.1")).toBe(false)
    expect(losesVersionManagement("v1.3.3")).toBe(true)
    expect(losesVersionManagement("v1.3.4")).toBe(true)
    expect(losesVersionManagement("1.3.2")).toBe(true)
    expect(losesVersionManagement("v1.2.0")).toBe(true)
    expect(losesVersionManagement("v1.3.2")).toBe(true)
  })

  it("classifies upgrade current and downgrade", () => {
    expect(luxVersionRelation("1.3.2", "v1.3.3")).toBe("upgrade")
    expect(luxVersionRelation("1.3.3", "v1.3.3")).toBe("current")
    expect(luxVersionRelation("1.3.3", "v1.3.2")).toBe("downgrade")
    expect(luxVersionRelation("1.3.2", "main")).toBeNull()
  })

  it("rejects unsafe or unknown switch tags", () => {
    const known = ["v1.3.3", "v1.3.2"]
    expect(validateLuxSwitchTag("v1.3.3", known)).toBeNull()
    expect(validateLuxSwitchTag("v1.3.3;rm", known)).toBe("Release tag must be vX.Y.Z")
    expect(validateLuxSwitchTag("main", known)).toBe("Release tag must be vX.Y.Z")
    expect(validateLuxSwitchTag("v9.9.9", known)).toBe("Unknown release tag")
    expect(validateLuxSwitchTag("", known)).toBe("Release tag is required")
    expect(validateLuxSwitchTag("v1.3.3-beta", known)).toBe("Release tag must be vX.Y.Z")
  })

  it("builds a snapshot from GitHub releases", () => {
    const snap = buildLuxReleasesSnapshot("1.3.2", [
      {
        tag_name: "v1.3.4",
        name: "1.3.4",
        draft: false,
        prerelease: false,
        published_at: "2026-09-20T00:00:00Z",
        html_url: "https://github.com/ryokubaka/ludus-ux/releases/tag/v1.3.4",
        body: "## Notes\n- hello",
      },
      {
        tag_name: "v1.4.0-rc1",
        draft: false,
        prerelease: true,
      },
      {
        tag_name: "v1.9.9",
        draft: true,
        prerelease: false,
      },
      {
        tag_name: "v1.3.2",
        draft: false,
        prerelease: false,
        published_at: "2026-09-10T00:00:00Z",
        html_url: "https://github.com/ryokubaka/ludus-ux/releases/tag/v1.3.2",
        body: "current",
      },
      {
        tag_name: "v1.2.0",
        draft: false,
        prerelease: false,
        published_at: "2026-07-01T00:00:00Z",
        html_url: "https://github.com/ryokubaka/ludus-ux/releases/tag/v1.2.0",
        body: "old",
      },
    ])

    expect(snap.updateAvailable).toBe(true)
    expect(snap.latestStable).toBe("v1.3.4")
    expect(snap.releases.map((r) => r.tag)).toEqual(["v1.3.4", "v1.3.2", "v1.2.0"])
    expect(snap.releases[0]?.relation).toBe("upgrade")
    expect(snap.releases[1]?.relation).toBe("current")
    expect(snap.releases[2]?.relation).toBe("downgrade")
    expect(snap.releases[2]?.losesVersionManagement).toBe(true)
    expect(snap.releases.some((r) => r.tag === "v1.4.0-rc1")).toBe(false)
  })

  it("does not treat a prerelease as the update banner target", () => {
    const snap = buildLuxReleasesSnapshot("1.3.2", [
      {
        tag_name: "v1.4.0",
        draft: false,
        prerelease: true,
      },
      {
        tag_name: "v1.3.2",
        draft: false,
        prerelease: false,
      },
    ])
    expect(snap.latestStable).toBe("v1.3.2")
    expect(snap.updateAvailable).toBe(false)
    expect(snap.releases[0]?.prerelease).toBe(true)
    expect(snap.releases[0]?.relation).toBe("upgrade")
  })

  it("reads a failed switch from the host log", () => {
    const log = [
      "=== LUX switch to v1.3.2 started 2026-09-28T00:00:00Z ===",
      "Error: tag 'v1.3.2' not found after fetch.",
      "LUX_UPGRADE_EXIT:1",
    ].join("\n")
    expect(luxUpgradeFailureFromLog(log, "v1.3.2")).toBe("Error: tag 'v1.3.2' not found after fetch.")
    expect(luxUpgradeFailureFromLog(log, "v1.3.3")).toBeNull()
    expect(luxUpgradeFailureFromLog(`${log}\nLUX_UPGRADE_EXIT:0`, "v9.9.9")).toBeNull()
    const ok = "=== LUX switch to v1.3.4 started ===\nDone. Running:\nLUX_UPGRADE_EXIT:0"
    expect(luxUpgradeFailureFromLog(ok, "v1.3.4")).toBeNull()
  })

  it("excerpts release notes", () => {
    expect(excerptReleaseNotes("## Title\n\nHello **world**", 20)).toBe("Title Hello world")
    expect(excerptReleaseNotes("a".repeat(300)).endsWith("…")).toBe(true)
  })
})
