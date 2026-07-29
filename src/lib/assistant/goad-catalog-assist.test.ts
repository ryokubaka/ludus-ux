import { describe, expect, it } from "vitest"
import {
  auditRequiredTemplates,
  matchGoadLabByRequest,
  normalizeGoadLabKey,
  parseLudusTemplateBuiltMap,
  summarizeGoadCatalogForAssistant,
} from "./goad-catalog-assist"

describe("goad-catalog-assist", () => {
  const labs = [
    { name: "ADFS", requiredTemplates: ["debian-12-x64-server-template"] },
    { name: "GOAD", requiredTemplates: ["win2019-server-x64-template"] },
    { name: "GOAD-Mini", requiredTemplates: ["win2019-server-x64-template", "win2016-server-x64-template"] },
    { name: "NHA", requiredTemplates: ["win2019-server-x64-template"] },
  ]

  it("normalizes keys", () => {
    expect(normalizeGoadLabKey("GOAD_Mini")).toBe("goad-mini")
    expect(normalizeGoadLabKey(" goad mini ")).toBe("goad-mini")
  })

  it("matches GOAD-Mini and not ADFS (labs[0])", () => {
    expect(matchGoadLabByRequest(labs, "GOAD-Mini")?.name).toBe("GOAD-Mini")
    expect(matchGoadLabByRequest(labs, "goad mini")?.name).toBe("GOAD-Mini")
    expect(matchGoadLabByRequest(labs, "Deploy GOAD-Mini range")?.name).toBe("GOAD-Mini")
    expect(matchGoadLabByRequest(labs, "GOAD")?.name).toBe("GOAD")
  })

  it("summarizes catalog with labNames first and anti-labs[0] hint", () => {
    const summary = summarizeGoadCatalogForAssistant({
      configured: true,
      goadPath: "/opt/GOAD-mod",
      labs,
      extensions: [{ name: "exchange" }],
    })
    expect(summary?.labNames[0]).toBe("ADFS")
    expect(summary?.labNames).toContain("GOAD-Mini")
    expect(summary?.labs.find((l) => l.name === "GOAD-Mini")?.requiredTemplates).toEqual([
      "win2019-server-x64-template",
      "win2016-server-x64-template",
    ])
    expect(summary?.templateStatusJoined).toBe(false)
    expect(summary?.assistant_hint).toMatch(/NEVER use labs\[0\]/i)
    expect(summary?.assistant_hint).toMatch(/GOAD-Mini/)
    expect(summary?.assistant_hint).toMatch(/PHASE 1|goad-deploy|--dedicated|createRange|body\.args/i)
    expect(summary?.assistant_hint).toMatch(/lux_goad|ludus_blueprint/i)
    expect(summary?.assistant_hint).toMatch(/call_lux_api/i)
    expect(summary?.assistant_hint).not.toMatch(/Prefer \/goad wizard/i)
  })

  it("parses Ludus template rows into built map", () => {
    const map = parseLudusTemplateBuiltMap([
      { name: "win2019-server-x64-template", built: true },
      { name: "win2016-server-x64-template", built: false, status: "not_built" },
      { name: "win2022-server-x64-template", built: false },
    ])
    expect(map.get("win2019-server-x64-template")).toBe(true)
    expect(map.get("win2016-server-x64-template")).toBe(false)
    expect(map.has("win2022-server-x64-template")).toBe(true)
  })

  it("audits required templates into built / needBuild / missing", () => {
    const map = new Map<string, boolean>([
      ["win2019-server-x64-template", true],
      ["win2016-server-x64-template", false],
    ])
    const audit = auditRequiredTemplates(
      ["win2019-server-x64-template", "win2016-server-x64-template", "debian-12-x64-server-template"],
      map,
    )
    expect(audit.built).toEqual(["win2019-server-x64-template"])
    expect(audit.needBuild).toEqual(["win2016-server-x64-template"])
    expect(audit.missing).toEqual(["debian-12-x64-server-template"])
    expect(audit.ready).toBe(false)
  })

  it("joins templateAudit onto catalog labs when templates provided", () => {
    const summary = summarizeGoadCatalogForAssistant(
      { configured: true, goadPath: "/opt/GOAD", labs, extensions: [] },
      [
        { name: "debian-11-x64-server-template", built: true },
        { name: "win2019-server-x64-template", built: true },
        { name: "win2016-server-x64-template", built: true },
        { name: "win2022-server-x64-template", built: false },
      ],
    )
    expect(summary?.templateStatusJoined).toBe(true)
    const mini = summary?.labs.find((l) => l.name === "GOAD-Mini")
    expect(mini?.templateAudit?.ready).toBe(true)
    expect(mini?.templateAudit?.built).toEqual([
      "debian-11-x64-server-template",
      "win2019-server-x64-template",
      "win2016-server-x64-template",
    ])
    expect(mini?.templateAudit?.needBuild).toEqual([])
    expect(summary?.assistant_hint).toMatch(/templateAudit|needBuild|never rebuild/i)
    expect(summary?.assistant_hint).toMatch(/Do not eject to \/goad/i)
    expect(summary?.assistant_hint).toMatch(/debian-11-x64-server-template/)
  })

  it("marks lab not ready when router template missing", () => {
    const summary = summarizeGoadCatalogForAssistant(
      { configured: true, goadPath: "/opt/GOAD", labs, extensions: [] },
      [
        { name: "win2019-server-x64-template", built: true },
        { name: "win2016-server-x64-template", built: true },
      ],
    )
    const mini = summary?.labs.find((l) => l.name === "GOAD-Mini")
    expect(mini?.templateAudit?.ready).toBe(false)
    expect(mini?.templateAudit?.missing).toContain("debian-11-x64-server-template")
  })
})
