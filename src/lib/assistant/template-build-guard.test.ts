import { describe, expect, it } from "vitest"
import {
  extractBuildTemplateNames,
  guardBuildTemplatesAgainstBuiltMap,
  summarizeTemplatesForAssistant,
} from "./template-build-guard"

describe("template-build-guard", () => {
  it("extracts names from body.templates", () => {
    expect(extractBuildTemplateNames({ templates: ["win2019-server-x64-template"] })).toEqual([
      "win2019-server-x64-template",
    ])
    expect(
      extractBuildTemplateNames({ templates: [{ name: "a-template" }, "b-template"] }),
    ).toEqual(["a-template", "b-template"])
  })

  it("refuses rebuild when all requested are already built", () => {
    const map = new Map([["win2019-server-x64-template", true]])
    const r = guardBuildTemplatesAgainstBuiltMap(["win2019-server-x64-template"], map)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.alreadyBuilt).toEqual(["win2019-server-x64-template"])
      expect(r.error).toMatch(/already built/i)
      expect(r.assistant_hint).toMatch(/Do NOT call buildTemplates|ask_user|executeGoad/i)
    }
  })

  it("refuses mixed body that still includes built names", () => {
    const map = new Map([
      ["win2019-server-x64-template", true],
      ["win2016-server-x64-template", false],
    ])
    const r = guardBuildTemplatesAgainstBuiltMap(
      ["win2019-server-x64-template", "win2016-server-x64-template"],
      map,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.alreadyBuilt).toEqual(["win2019-server-x64-template"])
      expect(r.needBuild).toEqual(["win2016-server-x64-template"])
      expect(r.assistant_hint).toMatch(/Only build these: win2016/i)
    }
  })

  it("allows build for not_built only", () => {
    const map = new Map([
      ["win2019-server-x64-template", true],
      ["win2016-server-x64-template", false],
    ])
    const r = guardBuildTemplatesAgainstBuiltMap(["win2016-server-x64-template"], map)
    expect(r).toEqual({ ok: true, toBuild: ["win2016-server-x64-template"] })
  })

  it("summarizes list into built / not_built", () => {
    const s = summarizeTemplatesForAssistant([
      { name: "win2019-server-x64-template", built: true },
      { name: "win2022-server-x64-template", built: false },
    ])
    expect(s.built).toEqual(["win2019-server-x64-template"])
    expect(s.not_built).toEqual(["win2022-server-x64-template"])
    expect(s.assistant_note).toMatch(/NEVER buildTemplates for names in built/i)
  })
})
