import { describe, expect, it } from "vitest"
import yaml from "js-yaml"
import {
  RANGE_ID_HOSTNAME_NOTE,
  appendRangeIdHostnameNote,
  hostnameWithoutRangeId,
  stripRangeIdHostnames,
  yamlHostnamesIncludeRangeId,
} from "@/lib/range/hostname-range-id"

const LAB = `ludus:
  - vm_name: "{{ range_id }}-GOAD-DC01"
    hostname: "{{ range_id }}-DC01"
    template: win2019-server-x64-template
    vlan: 10
    ip_last_octet: 10
    windows:
      sysprep: true
  - vm_name: "{{ range_id }}-elk"
    hostname: "{{ range_id }}-elk"
    template: ubuntu-22.04-x64-server-template
    vlan: 10
    ip_last_octet: 50
    linux: true
router:
  vm_name: "{{ range_id }}-router"
  hostname: "{{ range_id }}-router"
`

describe("hostnames", () => {
  it("drops a leading range id token and keeps the rest of the name", () => {
    expect(hostnameWithoutRangeId("{{ range_id }}-DC01")).toBe("DC01")
    expect(hostnameWithoutRangeId("{{range_id}}-WS01")).toBe("WS01")
    expect(hostnameWithoutRangeId("srv-{{ range_id }}")).toBe("srv")
    expect(hostnameWithoutRangeId("DC01")).toBe("DC01")
  })

  it("strips every hostname and leaves vm_name", () => {
    const doc = yaml.load(stripRangeIdHostnames(LAB)) as {
      ludus: Array<Record<string, unknown>>
      router: Record<string, unknown>
    }
    expect(doc.ludus[0].vm_name).toBe("{{ range_id }}-GOAD-DC01")
    expect(doc.ludus[0].hostname).toBe("DC01")
    expect(doc.ludus[1].hostname).toBe("elk")
    expect(doc.ludus[1].vm_name).toBe("{{ range_id }}-elk")
    expect(doc.router.hostname).toBe("router")
    expect(doc.router.vm_name).toBe("{{ range_id }}-router")
  })

  it("returns the original text when no hostname has the token", () => {
    const yamlText = "ludus:\n  - vm_name: a\n    hostname: a\n    linux: true\n"
    expect(stripRangeIdHostnames(yamlText)).toBe(yamlText)
  })

  it("explains a hostname that still includes the token", () => {
    expect(yamlHostnamesIncludeRangeId(LAB)).toBe(true)
    expect(yamlHostnamesIncludeRangeId("ludus:\n  - hostname: elk\n")).toBe(false)
    expect(appendRangeIdHostnameNote(LAB, "Saved.")).toBe(`Saved. ${RANGE_ID_HOSTNAME_NOTE}`)
    expect(appendRangeIdHostnameNote("ludus:\n  - hostname: elk\n", "Saved.")).toBe("Saved.")
  })
})
