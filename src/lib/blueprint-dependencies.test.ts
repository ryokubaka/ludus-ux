import { describe, expect, it } from "vitest"
import {
  extractConfigRoleRefs,
  extractConfigTemplates,
  findMissingRequirements,
  findMissingTemplateRequirements,
  mergeBlueprintRequirements,
  parseRequirementsYaml,
  resolveBlueprintRequirements,
  roleRefToRequirements,
  templateRequirementsFromConfigYaml,
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

  it("matches short role name when namespaced role is installed", () => {
    const installedNs: AnsibleItem[] = [
      { name: "ryokubaka.ludus_securityonion", version: "1.0.0", type: "role" },
    ]
    const missing = findMissingRequirements(installedNs, [
      { kind: "role", name: "ludus_securityonion" },
    ])
    expect(missing).toEqual([])
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

const SO_CONFIG = `
ludus:
  - vm_name: "{{ range_id }}-so"
    template: securityonion-2.4-x64-template
  - vm_name: "{{ range_id }}-target"
    template: debian-12-x64-server-template
  - vm_name: "{{ range_id }}-kali"
    template: kali-x64-desktop-template
`

describe("extractConfigTemplates", () => {
  it("collects template fields from ludus VMs", () => {
    expect(extractConfigTemplates(SO_CONFIG)).toEqual([
      "debian-12-x64-server-template",
      "kali-x64-desktop-template",
      "securityonion-2.4-x64-template",
    ])
  })
})

describe("findMissingTemplateRequirements", () => {
  it("flags absent and unbuilt templates", () => {
    const required = templateRequirementsFromConfigYaml(SO_CONFIG)
    const missing = findMissingTemplateRequirements(required, [
      { name: "securityonion-2.4-x64-template", built: true },
      { name: "debian-12-x64-server-template", built: false },
    ])
    expect(missing.map((m) => `${m.name}:${m.templateStatus}`)).toEqual([
      "debian-12-x64-server-template:unbuilt",
      "kali-x64-desktop-template:absent",
    ])
  })
})
