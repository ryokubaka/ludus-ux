import { describe, expect, it } from "vitest"
import {
  hasUnresolvedRangeIdTemplate,
  substituteRangeIdInConfig,
} from "./range-config-templates"

describe("substituteRangeIdInConfig", () => {
  it("replaces spaced and tight range_id tokens", () => {
    const yaml = `ludus:
  - vm_name: "{{ range_id }}-WS01"
    hostname: "{{range_id}}-DC01"`
    const out = substituteRangeIdInConfig(yaml, "my-lab-range")
    expect(out).toContain('vm_name: "my-lab-range-WS01"')
    expect(out).toContain('hostname: "my-lab-range-DC01"')
    expect(hasUnresolvedRangeIdTemplate(out)).toBe(false)
  })

  it("leaves yaml unchanged when range id empty", () => {
    const yaml = 'vm_name: "{{ range_id }}-kali"'
    expect(substituteRangeIdInConfig(yaml, "  ")).toBe(yaml)
  })
})
