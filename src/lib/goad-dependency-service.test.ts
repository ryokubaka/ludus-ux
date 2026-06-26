import { describe, expect, it } from "vitest"
import {
  requirementsFromExtensionRoleRefs,
  extensionAnsibleDepsReady,
  parseAnsibleInstalledSets,
} from "@/lib/goad-dependency-service"
import {
  findMissingRequirements,
  requirementsFromConfigYaml,
} from "@/lib/blueprint-dependencies"
import type { AnsibleItem } from "@/lib/types"

const NEMESIS_CONFIG = `ludus:
  - vm_name: "{{ range_id }}-NEMESIS"
    hostname: "{{ range_id }}-NEMESIS"
    roles:
      - geerlingguy.docker
      - brmkit.ludus_nemesis
`

describe("extensionAnsibleDepsReady", () => {
  it("returns true when no roles required", () => {
    expect(extensionAnsibleDepsReady({ requiredRoles: [] }, null)).toBe(true)
  })

  it("returns false when roles required but ansible not loaded", () => {
    expect(extensionAnsibleDepsReady({ requiredRoles: ["geerlingguy.docker"] }, null)).toBe(
      false,
    )
  })

  it("returns false when role missing from installed sets", () => {
    const installed = parseAnsibleInstalledSets([])
    expect(
      extensionAnsibleDepsReady({ requiredRoles: ["geerlingguy.docker"] }, installed),
    ).toBe(false)
  })
})

describe("requirementsFromExtensionRoleRefs", () => {
  it("maps extension role refs to galaxy requirements", () => {
    const required = requirementsFromExtensionRoleRefs([
      "geerlingguy.docker",
      "brmkit.ludus_nemesis",
    ])
    expect(required.some((r) => r.kind === "role" && r.name === "geerlingguy.docker")).toBe(true)
    expect(required.some((r) => r.kind === "role" && r.name === "brmkit.ludus_nemesis")).toBe(true)
  })
})

describe("requirementsFromConfigYaml via goad deploy check inputs", () => {
  it("extracts roles from preview yaml", () => {
    const required = requirementsFromConfigYaml(NEMESIS_CONFIG)
    expect(required.map((r) => r.name).sort()).toEqual(
      ["brmkit.ludus_nemesis", "geerlingguy.docker"].sort(),
    )
  })

  it("finds missing when not installed", () => {
    const required = requirementsFromConfigYaml(NEMESIS_CONFIG)
    const installed: AnsibleItem[] = [{ name: "geerlingguy.docker", type: "role", version: "" }]
    const missing = findMissingRequirements(installed, required)
    expect(missing).toHaveLength(1)
    expect(missing[0]?.name).toBe("brmkit.ludus_nemesis")
  })
})
