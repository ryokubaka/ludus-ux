import { describe, expect, it } from "vitest"
import {
  blueprintShortName,
  installedBlueprintMatchesSource,
  registeredSourceLabel,
  sourceBlueprintInstallId,
  sourceIdsAreSameRegistration,
} from "./registered-ludus-sources"

describe("registered-ludus-sources", () => {
  it("strips source prefix from blueprint ids", () => {
    expect(blueprintShortName({ name: "src/goad" })).toBe("goad")
    expect(blueprintShortName({ sourceBlueprintID: "src/goad" })).toBe("goad")
    expect(blueprintShortName({ name: "AD + Elastic Security Range" })).toBe(
      "AD + Elastic Security Range",
    )
    expect(blueprintShortName({ sourceBlueprintID: "src/ad-elastic-range" })).toBe(
      "ad-elastic-range",
    )
    expect(sourceBlueprintInstallId({ name: "goad" }, "src")).toBe("src/goad")
  })

  it("treats a user-prefixed source id as the same registration, not a branch id", () => {
    expect(sourceIdsAreSameRegistration("ludus-source-bsl", "badsectorlabs-ludus-source-bsl")).toBe(
      true,
    )
    expect(
      sourceIdsAreSameRegistration(
        "ryokubaka-ludus-source-meow",
        "ryokubaka-ludus-source-meow-feat-securityonion-3-3-0",
      ),
    ).toBe(false)
    expect(
      installedBlueprintMatchesSource(
        "ryokubaka-ludus-source-meow-feat-securityonion-3-3-0/securityonion3-lab",
        "securityonion3-lab",
        "ryokubaka-ludus-source-meow",
      ),
    ).toBe(false)
    expect(
      installedBlueprintMatchesSource(
        "ryokubaka-ludus-source-meow/securityonion3-lab",
        "securityonion3-lab",
        "ryokubaka-ludus-source-meow",
      ),
    ).toBe(true)
  })

  it("includes the git ref so two registrations of one repo stay distinct", () => {
    expect(
      registeredSourceLabel({
        id: "meow-main",
        name: "Ludus Source – Meow",
        ref: "main",
      }),
    ).toBe("Ludus Source – Meow · main")
    expect(
      registeredSourceLabel({
        id: "meow-feat",
        name: "Ludus Source – Meow",
        ref: "feat/securityonion-3.3.0",
      }),
    ).toBe("Ludus Source – Meow · feat/securityonion-3.3.0")
  })
})
