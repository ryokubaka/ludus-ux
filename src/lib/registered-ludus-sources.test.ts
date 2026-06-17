import { describe, expect, it } from "vitest"
import { blueprintShortName, sourceBlueprintInstallId } from "./registered-ludus-sources"

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
})
