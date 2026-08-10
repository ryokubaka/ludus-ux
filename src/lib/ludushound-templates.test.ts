import { describe, expect, it } from "vitest"
import {
  auditTemplates,
  buildLudushoundRequiredTemplates,
  parseTemplatesFromLudusYaml,
} from "./ludushound-templates"
import { LUDUS_DEFAULT_ROUTER_TEMPLATE } from "./ludus-router-template"

describe("ludushound-templates", () => {
  it("parses template fields from ludus yaml", () => {
    const yml = `
ludus:
  - vm_name: a
    template: win2022-server-x64-template
  - vm_name: b
    template: win10-22h2-x64-enterprise-template
ludus_non_domain:
  - vm_name: c
    template: win2016-server-x64-template
`
    expect(parseTemplatesFromLudusYaml(yml)).toEqual([
      "win10-22h2-x64-enterprise-template",
      "win2016-server-x64-template",
      "win2022-server-x64-template",
    ])
  })

  it("includes router template from yaml VMs", () => {
    const req = buildLudushoundRequiredTemplates({
      yamlText: "ludus:\n  - template: win2016-server-x64-template\n",
    })
    expect(req.required).toContain(LUDUS_DEFAULT_ROUTER_TEMPLATE)
    expect(req.required).toContain("win2016-server-x64-template")
  })

  it("audits built vs absent", () => {
    const summary = auditTemplates(
      ["debian-11-x64-server-template", "win2016-server-x64-template"],
      ["debian-11-x64-server-template"],
      ["debian-11-x64-server-template", "win2016-server-x64-template"],
    )
    expect(summary.ready).toBe(false)
    expect(summary.missingUnbuilt).toEqual(["win2016-server-x64-template"])
  })
})
