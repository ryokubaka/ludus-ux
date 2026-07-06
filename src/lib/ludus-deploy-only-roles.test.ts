import { describe, expect, it } from "vitest"
import {
  ensureUserDefinedRolesTag,
  parseOnlyRolesCsv,
  parseSelectableDeployOnlyRoles,
  resolveDeployOnlyRoles,
  USER_DEFINED_ROLES_TAG,
} from "./ludus-deploy-only-roles"

const SAMPLE_CONFIG = `
ludus:
  - vm_name: "{{ range_id }}-elastic"
    roles:
      - name: badsectorlabs.ludus_elastic_container
  - vm_name: "{{ range_id }}-DC01"
    roles:
      - badsectorlabs.ludus_plain_role
      - name: badsectorlabs.ludus_elastic_agent
    depends_on:
      - vm_name: "{{ range_id }}-elastic"
        role: badsectorlabs.ludus_elastic_container
`

describe("parseOnlyRolesCsv", () => {
  it("splits, trims, and dedupes", () => {
    expect(parseOnlyRolesCsv(" a, b ,a, c")).toEqual(["a", "b", "c"])
  })

  it("returns empty for blank input", () => {
    expect(parseOnlyRolesCsv("  ,  ")).toEqual([])
  })
})

describe("parseSelectableDeployOnlyRoles", () => {
  it("collects roles from config YAML", () => {
    expect(parseSelectableDeployOnlyRoles(SAMPLE_CONFIG)).toEqual(
      expect.arrayContaining([
        "badsectorlabs.ludus_elastic_container",
        "badsectorlabs.ludus_plain_role",
        "badsectorlabs.ludus_elastic_agent",
      ]),
    )
  })

  it("returns empty for blank YAML", () => {
    expect(parseSelectableDeployOnlyRoles("")).toEqual([])
  })
})

describe("resolveDeployOnlyRoles", () => {
  it("returns undefined when nothing selected", () => {
    expect(resolveDeployOnlyRoles([], "")).toBeUndefined()
  })

  it("uses checkbox selection when no custom CSV", () => {
    expect(resolveDeployOnlyRoles(["role.a", "role.b"])).toEqual(["role.a", "role.b"])
  })

  it("custom CSV overrides checkboxes", () => {
    expect(resolveDeployOnlyRoles(["role.a"], "role.x, role.y")).toEqual(["role.x", "role.y"])
  })
})

describe("ensureUserDefinedRolesTag", () => {
  it("leaves tags unchanged when no only-roles", () => {
    expect(ensureUserDefinedRolesTag(["network"], undefined)).toEqual(["network"])
    expect(ensureUserDefinedRolesTag(undefined, undefined)).toBeUndefined()
  })

  it("injects user-defined-roles when only-roles set", () => {
    expect(ensureUserDefinedRolesTag(undefined, ["my.role"])).toEqual([USER_DEFINED_ROLES_TAG])
    expect(ensureUserDefinedRolesTag(["network"], ["my.role"])).toEqual([
      "network",
      USER_DEFINED_ROLES_TAG,
    ])
  })

  it("does not duplicate user-defined-roles", () => {
    expect(ensureUserDefinedRolesTag([USER_DEFINED_ROLES_TAG], ["my.role"])).toEqual([
      USER_DEFINED_ROLES_TAG,
    ])
  })
})
