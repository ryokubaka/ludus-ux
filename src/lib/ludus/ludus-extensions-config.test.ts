import { describe, expect, it } from "vitest"
import {
  applyLudusExtensions,
  extractLudusExtensions,
  goadSidecarSyncBody,
  ludusExtensionsEqual,
} from "@/lib/ludus/ludus-extensions-config"

const SAMPLE = `
ludus:
  - vm_name: "{{ range_id }}-dc"
    hostname: DC01
    template: win2022-server-x64-template
    vlan: 10
    ip_last_octet: 10
network:
  external_default: REJECT
ludus_extensions:
  notes: lab metadata
  tags:
    - purple
`.trim()

describe("ludus-extensions-config", () => {
  it("extracts ludus_extensions", () => {
    const snap = extractLudusExtensions(SAMPLE)
    expect(snap).toEqual({ notes: "lab metadata", tags: ["purple"] })
  })

  it("returns null when key absent", () => {
    expect(extractLudusExtensions("ludus: []\n")).toBeNull()
  })

  it("returns null for unparseable YAML", () => {
    expect(extractLudusExtensions("{{{{")).toBeNull()
  })

  it("apply preserves other keys and sets extensions", () => {
    const merged = applyLudusExtensions("ludus: []\nnetwork:\n  rules: []\n", { foo: 1 })
    expect(merged).toContain("ludus:")
    expect(merged).toContain("network:")
    expect(merged).toContain("ludus_extensions:")
    expect(merged).toContain("foo: 1")
  })

  it("apply with null leaves YAML unchanged", () => {
    const yaml = "ludus: []\n"
    expect(applyLudusExtensions(yaml, null)).toBe(yaml)
  })

  it("omits sidecar keys absent from both the loaded and saved YAML", () => {
    expect(goadSidecarSyncBody("ludus: []\n", "ludus: []\n")).toBeNull()
  })

  it("sends null only for a section the save removed", () => {
    const original = "network:\n  external_default: REJECT\nludus_extensions:\n  notes: keep\n"
    const saved = "ludus_extensions:\n  notes: keep\n"
    expect(goadSidecarSyncBody(original, saved)).toEqual({
      network: null,
      ludus_extensions: { notes: "keep" },
    })
  })

  it("drops removed extensions without deleting a network sidecar neither document has", () => {
    const original = "ludus_extensions:\n  notes: keep\n"
    const saved = "ludus: []\n"
    expect(goadSidecarSyncBody(original, saved)).toEqual({ ludus_extensions: null })
  })

  it("posts a network section the save added and omits extensions both lack", () => {
    const saved = "network:\n  external_default: ACCEPT\n"
    expect(goadSidecarSyncBody("ludus: []\n", saved)).toEqual({
      network: { external_default: "ACCEPT" },
    })
  })

  it("equality matches after apply", () => {
    const snap = { a: true }
    const yaml = applyLudusExtensions("ludus: []\n", snap)
    expect(ludusExtensionsEqual(yaml, snap)).toBe(true)
    expect(ludusExtensionsEqual("ludus: []\n", snap)).toBe(false)
  })
})
