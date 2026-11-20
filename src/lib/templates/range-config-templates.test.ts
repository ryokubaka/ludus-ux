import { describe, expect, it } from "vitest"
import {
  hasUnresolvedRangeIdTemplate,
  substituteRangeIdInConfig,
} from "@/lib/templates/range-config-templates"

describe("substituteRangeIdInConfig", () => {
  it("replaces spaced and tight range_id tokens", () => {
    const yaml = `ludus:
  - vm_name: "{{ range_id }}-WS01"
    hostname: "{{range_id}}-DC01"`
    const out = substituteRangeIdInConfig(yaml, "my-lab-range")
    expect(out).toContain('vm_name: "my-lab-range-WS01"')
    expect(out).toContain("hostname: DC01")
    expect(hasUnresolvedRangeIdTemplate(out)).toBe(false)
  })

  it("drops the token from a Windows hostname and still fills vm_name", () => {
    const yaml = `ludus:
  - vm_name: "{{ range_id }}-DC01"
    hostname: "{{ range_id }}-DC01"
    template: win2019-server-x64-template
    windows:
      sysprep: true
  - vm_name: "{{ range_id }}-kali"
    hostname: "{{ range_id }}-kali"
    linux: true
`
    const out = substituteRangeIdInConfig(yaml, "lab")
    expect(out).toContain('vm_name: "lab-DC01"')
    expect(out).toContain("hostname: DC01")
    expect(out).toContain("hostname: kali")
    expect(out).toContain('vm_name: "lab-kali"')
  })

  it("leaves yaml unchanged when range id empty", () => {
    const yaml = 'vm_name: "{{ range_id }}-kali"'
    expect(substituteRangeIdInConfig(yaml, "  ")).toBe(yaml)
  })
})
