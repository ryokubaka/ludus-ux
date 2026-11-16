import { describe, expect, it } from "vitest"
import type { GoadExtensionDef, GoadLabDef } from "@/lib/core/types"
import { LUDUS_DEFAULT_ROUTER_TEMPLATE } from "@/lib/ludus/ludus-router-template"
import {
  compatibleGoadExtensions,
  goadExtensionChoiceState,
  goadLabChoiceState,
  goadPickCanDeploy,
  type GoadPickReadiness,
} from "./goad-lab-choice"

const router = LUDUS_DEFAULT_ROUTER_TEMPLATE

function readiness(over: Partial<GoadPickReadiness> = {}): GoadPickReadiness {
  return {
    builtNames: new Set([router, "win2019-server-x64-template"]),
    allNames: new Set([router, "win2019-server-x64-template"]),
    ludusVersion: "",
    templatesLoading: false,
    ansible: { roles: new Set(["geerlingguy.docker"]), collections: new Set() },
    ansibleLoading: false,
    ...over,
  }
}

function lab(over: Partial<GoadLabDef> = {}): GoadLabDef {
  return {
    name: "GOAD-Light",
    description: "Small lab",
    vmCount: 5,
    domains: 2,
    requiredTemplates: ["win2019-server-x64-template"],
    ludusSupported: true,
    ...over,
  }
}

function ext(over: Partial<GoadExtensionDef> = {}): GoadExtensionDef {
  return {
    name: "adcs",
    description: "Certificate services",
    machines: ["SRV01"],
    compatibility: ["GOAD-Light"],
    impact: "",
    requiredTemplates: ["win2019-server-x64-template"],
    requiredRoles: ["geerlingguy.docker"],
    ...over,
  }
}

describe("goad lab choice", () => {
  it("lists extensions that install into the selected lab", () => {
    const rows = [
      ext({ name: "adcs" }),
      ext({ name: "sccm", compatibility: ["SCCM"] }),
      ext({ name: "elk", compatibility: ["*"] }),
    ]
    expect(compatibleGoadExtensions("GOAD-Light", rows).map((row) => row.name)).toEqual(["adcs", "elk"])
    expect(compatibleGoadExtensions(null, rows)).toEqual([])
    expect(
      compatibleGoadExtensions("GOAD-Light", [ext({ compatibility: undefined as unknown as string[] })]).map((row) => row.name),
    ).toEqual([])
  })

  it("blocks a lab until its templates, including the router, are built", () => {
    expect(goadLabChoiceState(lab(), readiness()).selectable).toBe(true)
    expect(goadLabChoiceState(lab({ ludusSupported: false }), readiness()).reason).toBe("No Ludus provider")
    expect(
      goadLabChoiceState(lab(), readiness({ builtNames: new Set([router]), allNames: new Set([router]) })).reason,
    ).toBe("Missing templates")
  })

  it("blocks an extension that is missing an Ansible role", () => {
    expect(goadExtensionChoiceState(ext(), readiness()).selectable).toBe(true)
    expect(
      goadExtensionChoiceState(ext(), readiness({ ansible: { roles: new Set(), collections: new Set() } })).reason,
    ).toBe("Missing Ansible")
    expect(goadExtensionChoiceState(ext(), readiness({ ansibleLoading: true, ansible: null })).reason).toBe(
      "Checking Ansible",
    )
  })

  it("deploys only when the lab and every selected extension are ready", () => {
    const ready = goadPickCanDeploy({
      lab: lab(),
      selectedExtensions: ["adcs"],
      extensions: [ext()],
      readiness: readiness(),
    })
    expect(ready.ok).toBe(true)

    const missing = goadPickCanDeploy({
      lab: lab(),
      selectedExtensions: ["adcs"],
      extensions: [ext()],
      readiness: readiness({ ansible: { roles: new Set(), collections: new Set() } }),
    })
    expect(missing.ok).toBe(false)
    expect(goadPickCanDeploy({
      lab: null,
      selectedExtensions: [],
      extensions: [],
      readiness: readiness(),
    }).reason).toBe("Select a GOAD lab on the left.")
  })
})
