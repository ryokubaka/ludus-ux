import { describe, expect, it } from "vitest"
import {
  extractConfigRoleRefs,
  findMissingRequirements,
  mergeBlueprintRequirements,
  parseRequirementsYaml,
  resolveBlueprintRequirements,
  roleRefToRequirements,
} from "./blueprint-dependencies"
import type { AnsibleItem } from "./types"

const SAMPLE_CONFIG = `
ludus:
  - vm_name: "{{ range_id }}-elastic"
    roles:
      - name: badsectorlabs.ludus_elastic_container
  - vm_name: "{{ range_id }}-DC01"
    roles:
      - name: badsectorlabs.ludus_windows_utils.ludus_ad_password_policy
      - name: badsectorlabs.ludus_elastic_agent
    depends_on:
      - vm_name: "{{ range_id }}-elastic"
        role: badsectorlabs.ludus_elastic_container
`

const SAMPLE_REQUIREMENTS = `
roles:
  - name: badsectorlabs.ludus_elastic_container
  - name: badsectorlabs.ludus_elastic_agent
collections:
  - name: badsectorlabs.ludus_windows_utils
    version: ">=1.2.0"
`

describe("roleRefToRequirements", () => {
  it("maps collection FQCN to collection requirement", () => {
    expect(roleRefToRequirements("badsectorlabs.ludus_windows_utils.ludus_ad_password_policy")).toEqual([
      {
        kind: "collection",
        name: "badsectorlabs.ludus_windows_utils",
        referencedBy: "badsectorlabs.ludus_windows_utils.ludus_ad_password_policy",
      },
    ])
  })

  it("maps galaxy role to role requirement", () => {
    expect(roleRefToRequirements("badsectorlabs.ludus_elastic_container")).toEqual([
      {
        kind: "role",
        name: "badsectorlabs.ludus_elastic_container",
        referencedBy: "badsectorlabs.ludus_elastic_container",
      },
    ])
  })
})

describe("parseRequirementsYaml", () => {
  it("parses roles and collections with versions", () => {
    const parsed = parseRequirementsYaml(SAMPLE_REQUIREMENTS)
    expect(parsed).toEqual(
      expect.arrayContaining([
        { kind: "role", name: "badsectorlabs.ludus_elastic_container" },
        { kind: "role", name: "badsectorlabs.ludus_elastic_agent" },
        { kind: "collection", name: "badsectorlabs.ludus_windows_utils", version: ">=1.2.0" },
      ]),
    )
  })
})

describe("extractConfigRoleRefs", () => {
  it("collects roles and depends_on references", () => {
    expect(extractConfigRoleRefs(SAMPLE_CONFIG)).toEqual(
      expect.arrayContaining([
        "badsectorlabs.ludus_elastic_container",
        "badsectorlabs.ludus_windows_utils.ludus_ad_password_policy",
        "badsectorlabs.ludus_elastic_agent",
      ]),
    )
  })
})

describe("findMissingRequirements", () => {
  const installed: AnsibleItem[] = [
    { name: "badsectorlabs.ludus_elastic_container", version: "1.0.0", type: "role" },
  ]

  it("detects missing collection and roles", () => {
    const required = resolveBlueprintRequirements(SAMPLE_CONFIG, SAMPLE_REQUIREMENTS)
    const missing = findMissingRequirements(installed, required)
    expect(missing.map((m) => `${m.kind}:${m.name}`)).toEqual(
      expect.arrayContaining([
        "collection:badsectorlabs.ludus_windows_utils",
        "role:badsectorlabs.ludus_elastic_agent",
      ]),
    )
    expect(missing.some((m) => m.name === "badsectorlabs.ludus_elastic_container")).toBe(false)
  })
})

describe("mergeBlueprintRequirements", () => {
  it("keeps version from requirements.yml when config also implies the item", () => {
    const merged = mergeBlueprintRequirements(
      parseRequirementsYaml(SAMPLE_REQUIREMENTS),
      roleRefToRequirements("badsectorlabs.ludus_windows_utils.ludus_ad_password_policy"),
    )
    const coll = merged.find((m) => m.name === "badsectorlabs.ludus_windows_utils")
    expect(coll?.version).toBe(">=1.2.0")
  })
})
