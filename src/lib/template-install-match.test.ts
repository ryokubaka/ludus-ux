import { describe, expect, it } from "vitest"
import {
  buildInstalledTemplateNameSet,
  buildCatalogTemplatePresenceMap,
  catalogMatchesInstalledName,
  getCatalogTemplatePresence,
  isTemplateCatalogNameInstalled,
  resolveInstalledTemplateName,
  templateCatalogNamesForInstalled,
} from "./template-install-match"

describe("template-install-match", () => {
  it("maps installed ludus name to catalog aliases", () => {
    expect(templateCatalogNamesForInstalled("debian12-template")).toEqual([
      "debian12-template",
      "debian12",
    ])
  })

  it("matches catalog directory name to installed -template suffix", () => {
    const installed = new Set(["win2022-template"])
    expect(isTemplateCatalogNameInstalled("win2022", installed)).toBe(true)
    expect(isTemplateCatalogNameInstalled("win2022-template", installed)).toBe(true)
    expect(isTemplateCatalogNameInstalled("kali", installed)).toBe(false)
  })

  it("matches catalog dir to longer Packer template name", () => {
    expect(
      catalogMatchesInstalledName("securityonion-3", "securityonion-3-x64-template"),
    ).toBe(true)
    expect(
      catalogMatchesInstalledName("securityonion-2.4", "securityonion-2.4-x64-template"),
    ).toBe(true)
    // shorter sibling must not steal a dotted version
    expect(
      catalogMatchesInstalledName("securityonion-2", "securityonion-2.4-x64-template"),
    ).toBe(false)
  })

  it("builds lookup set with both forms", () => {
    const lookup = buildInstalledTemplateNameSet(["debian12-template"])
    expect(lookup.has("debian12")).toBe(true)
    expect(lookup.has("debian12-template")).toBe(true)
  })

  it("maps catalog presence from ludus built flag", () => {
    const map = buildCatalogTemplatePresenceMap([
      { name: "debian12-template", built: false },
      { name: "win2022-template", built: true },
      { name: "securityonion-3-x64-template", built: false },
    ])
    expect(getCatalogTemplatePresence("debian12", map)).toBe("added")
    expect(getCatalogTemplatePresence("win2022", map)).toBe("built")
    expect(getCatalogTemplatePresence("securityonion-3", map)).toBe("added")
    expect(getCatalogTemplatePresence("kali", map)).toBe("none")
  })

  it("resolves full Ludus name for catalog dir", () => {
    expect(
      resolveInstalledTemplateName("securityonion-3", [
        { name: "securityonion-3-x64-template" },
        { name: "debian-12-x64-server-template" },
      ]),
    ).toBe("securityonion-3-x64-template")
  })
})
