import { describe, expect, it } from "vitest"
import {
  buildInstalledAnsibleNames,
  buildInstalledAnsibleVersions,
  buildInstalledBlueprintIds,
  buildInstalledBlueprintVersions,
  catalogVersionsDiffer,
  formatVersionTransition,
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
