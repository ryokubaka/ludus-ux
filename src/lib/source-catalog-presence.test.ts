import { describe, expect, it } from "vitest"
import {
  buildInstalledAnsibleNames,
  buildInstalledAnsibleVersions,
  buildInstalledBlueprintIds,
  buildInstalledBlueprintVersions,
  branchResyncNeeded,
  catalogVersionsDiffer,
  compareDottedVersions,
  formatVersionTransition,
  resolveAnsibleBranchView,
  siblingRefForInstalledVersion,
  isAnsibleCatalogNameInstalled,
  isBlueprintCatalogEntryInstalled,
  isSourceCatalogAnsibleInstalled,
  isSourceCatalogBlueprintInstalled,
  sourceCatalogAnsibleInstallState,
  sourceCatalogBlueprintInstallState,
} from "@/lib/source-catalog-presence"

describe("source-catalog-presence", () => {
  it("matches installed blueprints by full id or short name", () => {
    const installed = buildInstalledBlueprintIds([
      { id: "bsl/ad-elastic-range-clean" },
    ])
    expect(
      isSourceCatalogBlueprintInstalled(
        { name: "ad-elastic-range-clean" },
        "bsl",
        installed,
      ),
    ).toBe(true)
    expect(
      isSourceCatalogBlueprintInstalled({ name: "other-bp" }, "bsl", installed),
    ).toBe(false)
  })

  it("matches catalog rows when Ludus returns source-prefixed names", () => {
    const installed = buildInstalledBlueprintIds([{ id: "goad" }])
    expect(
      isBlueprintCatalogEntryInstalled(
        { name: "src123/goad", sourceBlueprintID: "src123/goad" },
        "src123",
        installed,
      ),
    ).toBe(true)
    expect(isBlueprintCatalogEntryInstalled({ name: "src123/goad" }, undefined, installed)).toBe(
      true,
    )
  })

  it("matches ansible catalog names case-insensitively", () => {
    const installed = buildInstalledAnsibleNames(
      [{ name: "ludus_adcs", version: "1.0", type: "role" }],
      [{ name: "community.general", version: "1.0", type: "collection" }],
    )
    expect(isAnsibleCatalogNameInstalled("Ludus_ADCS", installed)).toBe(true)
    expect(isAnsibleCatalogNameInstalled("missing.role", installed)).toBe(false)
  })

  it("matches FQCN installed names to short catalog dir names", () => {
    const installed = buildInstalledAnsibleNames(
      [],
      [{ name: "badsectorlabs.ludus_windows_utils", version: "1.0", type: "collection" }],
    )
    expect(isAnsibleCatalogNameInstalled("ludus_windows_utils", installed)).toBe(true)
    expect(isSourceCatalogAnsibleInstalled({ name: "ludus_windows_utils" }, installed)).toBe(true)
  })

  it("ignores stale Ludus catalog install state when GET /ansible has no match", () => {
    const installed = new Set<string>()
    expect(
      isSourceCatalogAnsibleInstalled(
        { name: "ryokubaka.ludus_securityonion", scope: "local", state: "installed" },
        installed,
      ),
    ).toBe(false)
    expect(
      sourceCatalogAnsibleInstallState(
        { name: "ryokubaka.ludus_securityonion", state: "upgrade_available", version: "2.0.0" },
        installed,
        new Map([["ryokubaka.ludus_securityonion", "1.0.0"]]),
      ),
    ).toBe("not_installed")
  })

  it("marks ansible upgrade_available only from real version diff", () => {
    const installed = buildInstalledAnsibleNames(
      [{ name: "ryokubaka.ludus_securityonion", version: "1.0.0", type: "role" }],
      [],
    )
    const versions = buildInstalledAnsibleVersions(
      [{ name: "ryokubaka.ludus_securityonion", version: "1.0.0", type: "role" }],
      [],
    )
    expect(
      sourceCatalogAnsibleInstallState(
        { name: "ryokubaka.ludus_securityonion", version: "1.1.0" },
        installed,
        versions,
      ),
    ).toBe("upgrade_available")
    // Sticky Ludus catalog state alone must not keep Update available after re-sync
    expect(
      sourceCatalogAnsibleInstallState(
        { name: "ryokubaka.ludus_securityonion", version: "1.0.0", state: "upgrade_available" },
        installed,
        versions,
      ),
    ).toBe("installed")
    expect(
      sourceCatalogAnsibleInstallState(
        { name: "ryokubaka.ludus_securityonion", version: "1.0.0" },
        installed,
        versions,
      ),
    ).toBe("installed")
  })

  it("does not treat unequal when either side empty (raw differ helper)", () => {
    expect(catalogVersionsDiffer("1.0.0", "")).toBe(false)
    expect(catalogVersionsDiffer(undefined, "1.0.0")).toBe(false)
    expect(formatVersionTransition("1.0.0", "1.1.0")).toBe("1.0.0 → 1.1.0")
    expect(formatVersionTransition("1.0.1", "1.0.2")).toBe("1.0.1 → 1.0.2")
    expect(formatVersionTransition("(unknown version)", "1.0.2")).toBe("— → 1.0.2")
    expect(formatVersionTransition("1.0.1", "")).toBe("1.0.1 → —")
  })

  it("treats a newer installed copy as ahead of an older branch", () => {
    expect(compareDottedVersions("1.1.0", "1.0.3")).toBe(1)
    expect(compareDottedVersions("1.0.3", "1.1.0")).toBe(-1)
    expect(compareDottedVersions("1.1.0", "1.1.0")).toBe(0)
    expect(
      siblingRefForInstalledVersion(
        ["ryokubaka.ludus_securityonion"],
        "1.1.0",
        [
          {
            ref: "main",
            label: "Meow",
            items: [{ name: "ryokubaka.ludus_securityonion", version: "1.0.3" }],
          },
          {
            ref: "feat/securityonion-3.3.0",
            label: "Meow",
            items: [{ name: "ryokubaka.ludus_securityonion", version: "1.1.0" }],
          },
        ],
      ),
    ).toBe("feat/securityonion-3.3.0")
  })

  it("treats unknown installed version + catalog tip as upgrade until LUX pin exists", () => {
    const installed = buildInstalledAnsibleNames(
      [{ name: "ryokubaka.ludus_securityonion", version: "", type: "role" }],
      [],
    )
    const versions = buildInstalledAnsibleVersions(
      [{ name: "ryokubaka.ludus_securityonion", version: "", type: "role" }],
      [],
    )
    expect(
      sourceCatalogAnsibleInstallState(
        { name: "ludus_securityonion", version: "1.0.0" },
        installed,
        versions,
      ),
    ).toBe("upgrade_available")
    // After re-sync, pin fills installedVersions → in sync
    expect(
      sourceCatalogAnsibleInstallState(
        { name: "ludus_securityonion", version: "1.0.0" },
        installed,
        new Map([["ludus_securityonion", "1.0.0"]]),
      ),
    ).toBe("installed")
    expect(
      sourceCatalogAnsibleInstallState(
        { name: "ludus_securityonion", version: "1.0.0", state: "upgrade_available" },
        buildInstalledAnsibleNames(
          [{ name: "ryokubaka.ludus_securityonion", version: "(unknown version)", type: "role" }],
          [],
        ),
        buildInstalledAnsibleVersions(
          [{ name: "ryokubaka.ludus_securityonion", version: "(unknown version)", type: "role" }],
          [],
        ),
      ),
    ).toBe("upgrade_available")
  })

  it("does not treat another source's blueprint as installed here", () => {
    const ids = buildInstalledBlueprintIds([{ id: "feat/securityonion-lab", version: "1.1.0" }])
    expect(
      isSourceCatalogBlueprintInstalled({ name: "securityonion-lab" }, "feat", ids),
    ).toBe(true)
    expect(
      isSourceCatalogBlueprintInstalled({ name: "securityonion-lab" }, "main", ids),
    ).toBe(false)
  })

  it("keeps one installed copy when two branches publish different role versions", () => {
    const onDisk = resolveAnsibleBranchView({
      catalogVersion: "1.1.5",
      hostVersion: "1.1.5",
      pinVersion: "1.1.5",
      namePresent: true,
    })
    const otherBranch = resolveAnsibleBranchView({
      catalogVersion: "1.0.9",
      hostVersion: "1.1.5",
      pinVersion: "1.0.5",
      otherRef: "feat/securityonion-3.3.0",
      namePresent: true,
    })
    expect(onDisk.installedHere).toBe(true)
    expect(onDisk.catalogAhead).toBe(false)
    expect(otherBranch.installedHere).toBe(false)
    expect(otherBranch.catalogAhead).toBe(false)
    expect(otherBranch.otherRef).toBe("feat/securityonion-3.3.0")
    expect(otherBranch.installedVersion).toBe("1.1.5")
  })

  it("treats the same version on two branches as the one installed copy", () => {
    const view = resolveAnsibleBranchView({
      catalogVersion: "1.0.6",
      hostVersion: "1.0.6",
      pinVersion: "1.0.6",
      otherRef: "main",
      namePresent: true,
    })
    expect(view.installedHere).toBe(true)
    expect(view.otherRef).toBeUndefined()
  })

  it("offers an update only for the branch that owns the installed copy", () => {
    const owner = resolveAnsibleBranchView({
      catalogVersion: "1.0.6",
      hostVersion: "1.0.4",
      pinVersion: "1.0.4",
      namePresent: true,
    })
    const other = resolveAnsibleBranchView({
      catalogVersion: "1.0.5",
      hostVersion: "1.0.4",
      otherRef: "feat/securityonion-3.3.0",
      namePresent: true,
    })
    expect(owner.catalogAhead).toBe(true)
    expect(owner.installedHere).toBe(false)
    expect(other.installedHere).toBe(false)
    expect(other.catalogAhead).toBe(false)
    expect(other.otherRef).toBe("feat/securityonion-3.3.0")
  })

  it("resyncs only when this branch's install is older than its catalog", () => {
    expect(branchResyncNeeded("1.0.3", "1.1.0")).toBe(true)
    expect(branchResyncNeeded("1.1.0", "1.0.3")).toBe(false)
    expect(branchResyncNeeded("1.1.0", "1.1.0")).toBe(false)
    expect(branchResyncNeeded(undefined, "1.1.0")).toBe(false)
  })

  it("marks blueprint upgrade when catalog and installed versions differ", () => {
    const ids = buildInstalledBlueprintIds([{ id: "meow/securityonion-lab", version: "1.0.0" }])
    const versions = buildInstalledBlueprintVersions([
      { id: "meow/securityonion-lab", version: "1.0.0" },
    ])
    expect(
      sourceCatalogBlueprintInstallState(
        { name: "securityonion-lab", version: "1.1.0" },
        "meow",
        ids,
        versions,
      ),
    ).toBe("upgrade_available")
  })
})
