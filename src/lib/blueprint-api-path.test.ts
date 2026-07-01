import { describe, expect, it } from "vitest"
import { isBlueprintInstallName, blueprintInstallNameFromFields } from "./blueprint-api-path"

describe("isBlueprintInstallName", () => {
  it("accepts simple names", () => {
    expect(isBlueprintInstallName("goad")).toBe(true)
    expect(isBlueprintInstallName("my-blueprint.v2")).toBe(true)
    expect(isBlueprintInstallName("bp_01")).toBe(true)
  })

  it("rejects names with slashes", () => {
    expect(isBlueprintInstallName("path/to/bp")).toBe(false)
  })

  it("rejects empty strings", () => {
    expect(isBlueprintInstallName("")).toBe(false)
  })

  it("rejects names with spaces", () => {
    expect(isBlueprintInstallName("my blueprint")).toBe(false)
  })

  it("rejects names longer than 120 chars", () => {
    expect(isBlueprintInstallName("a".repeat(121))).toBe(false)
  })

  it("accepts names at exactly 120 chars", () => {
    expect(isBlueprintInstallName("a".repeat(120))).toBe(true)
  })
})

describe("blueprintInstallNameFromFields", () => {
  it("extracts from path", () => {
    expect(blueprintInstallNameFromFields({ path: "blueprints/goad" })).toBe("goad")
  })

  it("strips leading ./blueprints/", () => {
    expect(blueprintInstallNameFromFields({ path: "./blueprints/my-bp" })).toBe("my-bp")
  })

  it("uses sourceBlueprintID when path is not valid", () => {
    expect(blueprintInstallNameFromFields({ sourceBlueprintID: "source/goad-v2" })).toBe("goad-v2")
  })

  it("uses id as fallback", () => {
    expect(blueprintInstallNameFromFields({ id: "goad" })).toBe("goad")
  })

  it("uses name as final fallback", () => {
    expect(blueprintInstallNameFromFields({ name: "My Blueprint" })).toBe("My Blueprint")
  })

  it("extracts tail after last slash from id", () => {
    expect(blueprintInstallNameFromFields({ id: "ludus-source-bsl/goad" })).toBe("goad")
  })
})
