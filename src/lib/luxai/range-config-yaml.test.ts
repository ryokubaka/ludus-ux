import { describe, expect, it } from "vitest"
import yaml from "js-yaml"
import { prepareUploadedYaml } from "@/lib/luxai/tools"

const TWO_VMS = `ludus:
  - vm_name: "{{ range_id }}-dc01"
    hostname: "{{ range_id }}-dc01"
    template: win2019-server-x64-template
    vlan: 10
    ip_last_octet: 10
    ram_gb: 8
    cpus: 4
    windows:
      sysprep: true
    domain:
      fqdn: meow.local
      role: primary-dc
  - vm_name: "{{ range_id }}-ws01"
    hostname: "{{ range_id }}-ws01"
    template: win11-25h2-x64-enterprise-template
    vlan: 21
    ip_last_octet: 21
    ram_gb: 8
    cpus: 4
    domain:
      fqdn: meow.local
      role: member
`

describe("prepareUploadedYaml", () => {
  it("adds windows to a Windows VM that omitted it and keeps a windows block that is already set", () => {
    const doc = yaml.load(prepareUploadedYaml(TWO_VMS)) as { ludus: Array<Record<string, unknown>> }
    expect(doc.ludus[0].windows).toEqual({ sysprep: true })
    expect(doc.ludus[1].windows).toEqual({ sysprep: false })
    expect(doc.ludus[1].linux).toBeUndefined()
    expect(doc.ludus[0].hostname).toBe("dc01")
    expect(doc.ludus[1].hostname).toBe("ws01")
    expect(doc.ludus[0].vm_name).toBe("{{ range_id }}-dc01")
    expect(doc.ludus[1].vm_name).toBe("{{ range_id }}-ws01")
  })

  it("adds linux: true when the template is not Windows", () => {
    const doc = yaml.load(prepareUploadedYaml(`ludus:
  - vm_name: a
    hostname: a
    template: kali-x64-desktop-template
    vlan: 10
    ip_last_octet: 11
    ram_gb: 2
    cpus: 1
`)) as { ludus: Array<Record<string, unknown>> }
    expect(doc.ludus[0].linux).toBe(true)
    expect(doc.ludus[0].windows).toBeUndefined()
  })

  it("leaves a VM that already has one OS key unchanged", () => {
    const source = `ludus:
  - vm_name: a
    hostname: a
    template: win2022-server-x64-template
    vlan: 10
    ip_last_octet: 11
    ram_gb: 2
    cpus: 1
    windows:
      sysprep: false
`
    expect(prepareUploadedYaml(source)).toBe(source.trim())
  })

  it("refuses a VM that sets two OS keys", () => {
    expect(() => prepareUploadedYaml(`ludus:
  - vm_name: a
    hostname: ws01
    template: win11-25h2-x64-enterprise-template
    vlan: 21
    ip_last_octet: 21
    ram_gb: 8
    cpus: 4
    windows:
      sysprep: false
    linux: true
`)).toThrow(/ws01 sets more than one/)
  })
})
