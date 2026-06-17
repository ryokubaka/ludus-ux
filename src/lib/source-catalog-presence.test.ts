import { describe, expect, it } from "vitest"
import {
  buildInstalledAnsibleNames,
  buildInstalledBlueprintIds,
  isAnsibleCatalogNameInstalled,
  isBlueprintCatalogEntryInstalled,
  isSourceCatalogAnsibleInstalled,
  isSourceCatalogBlueprintInstalled,
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

  it("prefers Ludus catalog install state when present", () => {
    const installed = new Set<string>()
    expect(
      isSourceCatalogAnsibleInstalled(
        { name: "badsectorlabs.ludus_windows_utils", state: "installed" },
        installed,
      ),
    ).toBe(true)
  })
})
