import { describe, expect, it } from "vitest"
import { extractRolesFromProviderYaml } from "./goad-provider-roles"

describe("extractRolesFromProviderYaml", () => {
  it("extracts a block list of scalar roles", () => {
    const yaml = `
ludus:
  - vm_name: "{{ range_id }}-DC"
    roles:
      - geerlingguy.docker
      - brmkit.ludus_nemesis
`
    expect(extractRolesFromProviderYaml(yaml)).toEqual([
      "brmkit.ludus_nemesis",
      "geerlingguy.docker",
    ])
  })

  it("extracts an inline list of roles", () => {
    const yaml = `
ludus:
  - vm_name: dc
    roles: [geerlingguy.docker, brmkit.ludus_nemesis]
`
    expect(extractRolesFromProviderYaml(yaml)).toEqual([
      "brmkit.ludus_nemesis",
      "geerlingguy.docker",
    ])
  })

  it("extracts dict role refs (role / name / src)", () => {
    const yaml = `
ludus:
  - vm_name: dc
    roles:
      - role: geerlingguy.docker
        vars:
          docker_edition: ce
      - name: some.collection.role
      - src: https://example.com/r.tar.gz
`
    expect(extractRolesFromProviderYaml(yaml)).toEqual([
      "geerlingguy.docker",
      "https://example.com/r.tar.gz",
      "some.collection.role",
    ])
  })

  it("returns [] for YAML without roles", () => {
    expect(extractRolesFromProviderYaml("ludus:\n  - vm_name: dc\n")).toEqual([])
  })

  it("returns [] for invalid YAML", () => {
    expect(extractRolesFromProviderYaml("{{{{")).toEqual([])
  })
})
