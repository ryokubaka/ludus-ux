import { describe, expect, it } from "vitest"
import {
  requirementsFromExtensionRoleRefs,
  extensionAnsibleDepsReady,
  extensionAnsibleState,
  parseAnsibleInstalledSets,
  withInstalling,
  withoutInstalling,
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

describe("extensionAnsibleState", () => {
  it("is ready when no roles are required", () => {
    expect(extensionAnsibleState({ requiredRoles: [] }, null)).toBe("ready")
  })

  it("is unknown when roles required but ansible not loaded", () => {
    expect(extensionAnsibleState({ requiredRoles: ["geerlingguy.docker"] }, null)).toBe(
      "unknown",
    )
  })

  it("is unknown while loading even if a set is present", () => {
    const installed = parseAnsibleInstalledSets([])
    expect(
      extensionAnsibleState({ requiredRoles: ["geerlingguy.docker"] }, installed, true),
    ).toBe("unknown")
  })

  it("is missing when a required role is absent from the installed set", () => {
    const installed = parseAnsibleInstalledSets([])
    expect(
      extensionAnsibleState({ requiredRoles: ["geerlingguy.docker"] }, installed),
    ).toBe("missing")
  })

  it("is ready when the required role is installed", () => {
    const installed = parseAnsibleInstalledSets([
      { name: "geerlingguy.docker", type: "role", version: "" },
    ])
    expect(
      extensionAnsibleState({ requiredRoles: ["geerlingguy.docker"] }, installed),
    ).toBe("ready")
  })
})

describe("withInstalling / withoutInstalling", () => {
  it("adds a name without mutating the source set", () => {
    const base = new Set<string>(["a"])
    const next = withInstalling(base, "b")
    expect([...next].sort()).toEqual(["a", "b"])
    expect([...base]).toEqual(["a"])
  })

  it("supports concurrent installs of different extensions", () => {
    let set: ReadonlySet<string> = new Set()
    set = withInstalling(set, "elk")
    set = withInstalling(set, "sccm")
    expect(set.has("elk")).toBe(true)
    expect(set.has("sccm")).toBe(true)
  })

  it("clears only its own name, leaving others' spinners intact", () => {
    let set: ReadonlySet<string> = new Set(["elk", "sccm"])
    set = withoutInstalling(set, "elk")
    expect(set.has("elk")).toBe(false)
    expect(set.has("sccm")).toBe(true)
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
