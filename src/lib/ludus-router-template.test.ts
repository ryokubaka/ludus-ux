import { describe, expect, it } from "vitest"
import {
  LUDUS_DEFAULT_ROUTER_TEMPLATE,
  LUDUS_LEGACY_ROUTER_TEMPLATE,
  checkRouterTemplateBuilt,
  inferRouterTemplateFromVmName,
  isRouterTemplateReadyForDeploy,
  ludusDefaultRouterVmName,
  resolveRequiredRouterTemplate,
  withRouterTemplateRequired,
} from "./ludus-router-template"

function builtMap(entries: Array<[string, boolean]>): Map<string, boolean> {
  return new Map(entries)
}

describe("ludus-router-template", () => {
  it("exports Debian 13 as current default and Debian 11 as legacy", () => {
    expect(LUDUS_DEFAULT_ROUTER_TEMPLATE).toBe("debian-13-x64-server-template")
    expect(LUDUS_LEGACY_ROUTER_TEMPLATE).toBe("debian-11-x64-server-template")
  })

  it("requires Debian 13 on Ludus 2.3.2+ when unpinned", () => {
    expect(
      resolveRequiredRouterTemplate({ ludusVersion: "2.3.2" }).template,
    ).toBe(LUDUS_DEFAULT_ROUTER_TEMPLATE)
    expect(
      resolveRequiredRouterTemplate({ ludusVersion: "2.3.1" }).template,
    ).toBe(LUDUS_LEGACY_ROUTER_TEMPLATE)
  })

  it("fails unpinned 2.3.2 deploy when only Debian 11 is built", () => {
    const map = builtMap([[LUDUS_LEGACY_ROUTER_TEMPLATE, true]])
    expect(
      checkRouterTemplateBuilt(map, { ludusVersion: "2.3.2", registeredTemplates: map }).ok,
    ).toBe(false)
  })

  it("passes unpinned 2.3.1 deploy when only Debian 11 is built", () => {
    const map = builtMap([[LUDUS_LEGACY_ROUTER_TEMPLATE, true]])
    expect(
      checkRouterTemplateBuilt(map, { ludusVersion: "2.3.1", registeredTemplates: map }).ok,
    ).toBe(true)
  })

  it("passes unpinned 2.3.2 deploy when Debian 13 is built", () => {
    const map = builtMap([[LUDUS_DEFAULT_ROUTER_TEMPLATE, true]])
    expect(
      checkRouterTemplateBuilt(map, { ludusVersion: "2.3.2", registeredTemplates: map }).ok,
    ).toBe(true)
  })

  it("honors pinned router.template on 2.3.2", () => {
    const yaml = `
router:
  vm_name: "{{ range_id }}-router-debian11-x64"
  template: debian-11-x64-server-template
`
    const map = builtMap([[LUDUS_LEGACY_ROUTER_TEMPLATE, true]])
    expect(
      checkRouterTemplateBuilt(map, {
        ludusVersion: "2.3.2",
        configYaml: yaml,
        registeredTemplates: map,
      }).ok,
    ).toBe(true)
  })

  it("infers Debian 13 from catalog when version unknown", () => {
    expect(
      resolveRequiredRouterTemplate({
        registeredTemplates: new Set([LUDUS_DEFAULT_ROUTER_TEMPLATE]),
      }).template,
    ).toBe(LUDUS_DEFAULT_ROUTER_TEMPLATE)
  })

  it("infers Debian 11 from catalog when only legacy is registered", () => {
    expect(
      resolveRequiredRouterTemplate({
        registeredTemplates: new Set([LUDUS_LEGACY_ROUTER_TEMPLATE]),
      }).template,
    ).toBe(LUDUS_LEGACY_ROUTER_TEMPLATE)
  })

  it("withRouterTemplateRequired prepends resolved template once", () => {
    expect(
      withRouterTemplateRequired(["win2019-server-x64-template"], { ludusVersion: "2.3.2" }),
    ).toEqual(["debian-13-x64-server-template", "win2019-server-x64-template"])
    expect(
      withRouterTemplateRequired(["win2019-server-x64-template"], { ludusVersion: "2.3.1" }),
    ).toEqual(["debian-11-x64-server-template", "win2019-server-x64-template"])
  })

  it("derives default router vm_name from Ludus version", () => {
    expect(ludusDefaultRouterVmName("lab", { ludusVersion: "2.3.2" })).toBe(
      "lab-router-debian13-x64",
    )
    expect(ludusDefaultRouterVmName("lab", { ludusVersion: "2.3.1" })).toBe(
      "lab-router-debian11-x64",
    )
  })

  it("infers router template from vm_name", () => {
    expect(inferRouterTemplateFromVmName("lab-router-debian11-x64")).toBe(
      "debian-11-x64-server-template",
    )
    expect(inferRouterTemplateFromVmName("lab-router-debian13-x64")).toBe(
      "debian-13-x64-server-template",
    )
  })

  it("isRouterTemplateReadyForDeploy respects version", () => {
    expect(
      isRouterTemplateReadyForDeploy({
        builtNames: new Set([LUDUS_DEFAULT_ROUTER_TEMPLATE]),
        allNames: new Set([LUDUS_DEFAULT_ROUTER_TEMPLATE]),
        ludusVersion: "2.3.2",
      }),
    ).toBe(true)
    expect(
      isRouterTemplateReadyForDeploy({
        builtNames: new Set([LUDUS_LEGACY_ROUTER_TEMPLATE]),
        allNames: new Set([LUDUS_LEGACY_ROUTER_TEMPLATE]),
        ludusVersion: "2.3.2",
      }),
    ).toBe(false)
  })
})
