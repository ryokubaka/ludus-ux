import { describe, expect, it } from "vitest"
import {
  mergeGoadPreviewWithNetworkRules,
  validateGoadConfigYaml,
} from "@/lib/goad-preview-config"
import type { NetworkRule } from "@/lib/network-rules"

const SAMPLE_PREVIEW = `ludus:
  - vm_name: "{{ range_id }}-NEMESIS"
    hostname: "{{ range_id }}-NEMESIS"
    roles:
      - geerlingguy.docker
`

describe("mergeGoadPreviewWithNetworkRules", () => {
  it("returns preview unchanged when no network rules", () => {
    expect(mergeGoadPreviewWithNetworkRules(SAMPLE_PREVIEW, [])).toBe(SAMPLE_PREVIEW)
  })

  it("injects network block when rules provided", () => {
    const rules: NetworkRule[] = [
      {
        name: "allow-443",
        action: "ACCEPT",
        protocol: "tcp",
        ports: "443",
        vlan_src: "public",
        vlan_dst: 10,
      },
    ]
    const merged = mergeGoadPreviewWithNetworkRules(SAMPLE_PREVIEW, rules)
    expect(merged).toContain("network:")
    expect(merged).toContain("allow-443")
  })
})

describe("validateGoadConfigYaml", () => {
  it("accepts valid ludus mapping", () => {
    expect(validateGoadConfigYaml(SAMPLE_PREVIEW).valid).toBe(true)
  })

  it("rejects empty yaml", () => {
    const result = validateGoadConfigYaml("   ")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it("rejects invalid yaml syntax", () => {
    const result = validateGoadConfigYaml("ludus:\n  - [broken")
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
