import { describe, expect, it } from "vitest"
import {
  buildDeployLimitPattern,
  extractInventoryText,
  mergeDeployLimitHosts,
  limitHostsFromRangeVms,
  parseAnsibleInventoryFromLudusPayload,
  parseAnsibleInventoryHosts,
  parseHostsFromRangeConfig,
  parseVmNameToHostnameMap,
  resolveLimitHostForRangeVm,
  resolveDeployLimitPattern,
  resolveRangeIdInHost,
} from "./ludus-deploy-limit"

describe("ludus-deploy-limit", () => {
  it("resolves range_id placeholders", () => {
    expect(resolveRangeIdInHost("{{ range_id }}-dc01", "lab1")).toBe("lab1-dc01")
    expect(resolveRangeIdInHost('"{{ range_id }}-ws"', "lab1")).toBe('"lab1-ws"')
  })

  it("parses hosts from range config YAML", () => {
    const yaml = `
ludus:
  - vm_name: "{{ range_id }}-dc01"
    hostname: "{{ range_id }}-dc01"
    template: win2022
  - vm_name: "{{ range_id }}-ws01"
    hostname: "{{ range_id }}-ws01"
    template: win11
`
    expect(parseHostsFromRangeConfig(yaml, "myrange")).toEqual([
      "myrange-dc01",
      "myrange-router",
      "myrange-ws01",
    ])
  })

  it("uses hostname only when vm_name differs (Ansible inventory keys)", () => {
    const yaml = `
ludus:
  - vm_name: '{{ range_id }}-GOAD-DC01'
    hostname: '{{ range_id }}-DC01'
  - vm_name: '{{ range_id }}-VELOCIRAPTOR'
    hostname: '{{ range_id }}-VELOCIRAPTOR'
  - vm_name: '{{ range_id }}-KALI-OPS'
    hostname: '{{ range_id }}-KALI-OPS'
  - vm_name: '{{ range_id }}-GOAD-W11-25H2'
    hostname: '{{ range_id }}-W1125H2'
`
    const rid = "smeowden-GOAD-Min1-IUMBUX"
    expect(parseHostsFromRangeConfig(yaml, rid)).toEqual([
      `${rid}-DC01`,
      `${rid}-KALI-OPS`,
      `${rid}-router`,
      `${rid}-VELOCIRAPTOR`,
      `${rid}-W1125H2`,
    ])
  })

  it("uses explicit router block hostname from config", () => {
    const yaml = `
ludus:
  - vm_name: "{{ range_id }}-dc01"
    hostname: "{{ range_id }}-dc01"
router:
  vm_name: "{{ range_id }}-router-debian12-x64"
  hostname: "{{ range_id }}-gw"
`
    expect(parseHostsFromRangeConfig(yaml, "lab")).toEqual(["lab-dc01", "lab-gw"])
  })

  it("maps default debian router vm name to ansible hostname on sync", () => {
    const yaml = `
ludus:
  - vm_name: '{{ range_id }}-GOAD-DC01'
    hostname: '{{ range_id }}-DC01'
`
    expect(resolveLimitHostForRangeVm("lab-router-debian11-x64", yaml, "lab")).toBe("lab-router")
  })

  it("parses ansible ini inventory hosts", () => {
    const inv = `
[windows]
myrange-dc01 ansible_host=10.1.10.10
myrange-ws01 ansible_host=10.1.10.11

[linux]
myrange-kali ansible_host=10.1.20.10
`
    expect(parseAnsibleInventoryHosts(inv)).toEqual([
      "myrange-dc01",
      "myrange-kali",
      "myrange-ws01",
    ])
  })

  it("parses ansible yaml inventory without vars or group keys", () => {
    const inv = `
all:
  vars:
    ansible_user: localuser
    ansible_become: true
    -vvvv: true
  children:
    ADMIN:
      hosts:
        range-router:
          ansible_host: 10.1.10.254
    ludus_range:
      hosts:
        range-DC01:
          ansible_host: 10.1.10.10
        range-KALI-OPS:
          ansible_host: 10.1.10.60
`
    expect(parseAnsibleInventoryHosts(inv)).toEqual([
      "range-DC01",
      "range-KALI-OPS",
      "range-router",
    ])
  })

  it("does not treat yaml var lines as hosts", () => {
    const junk = `
all:
  vars:
    ansible_host: 10.0.0.1
    ansible_user: admin
  children:
    ADMIN:
      hosts: {}
ansible_become_method: sudo
admin:
`
    expect(parseAnsibleInventoryHosts(junk)).toEqual([])
  })

  it("parses structured inventory from ludus api envelope object", () => {
    const payload = {
      result: {
        all: {
          children: {
            range: {
              hosts: {
                "lab-DC01": { ansible_host: "10.1.10.10" },
                "lab-KALI": { ansible_host: "10.1.10.60" },
              },
            },
          },
        },
      },
    }
    expect(parseAnsibleInventoryFromLudusPayload(payload)).toEqual(["lab-DC01", "lab-KALI"])
  })

  it("maps GET /range vm names to ansible hostnames via config", () => {
    const yaml = `
ludus:
  - vm_name: '{{ range_id }}-GOAD-DC01'
    hostname: '{{ range_id }}-DC01'
  - vm_name: '{{ range_id }}-GOAD-W11-25H2'
    hostname: '{{ range_id }}-W1125H2'
`
    const rid = "lab"
    expect(parseVmNameToHostnameMap(yaml, rid).get(`${rid}-GOAD-DC01`)).toBe(`${rid}-DC01`)
    expect(
      limitHostsFromRangeVms(
        [{ name: `${rid}-GOAD-DC01` }, { name: `${rid}-GOAD-W11-25H2` }],
        yaml,
        rid,
      ),
    ).toEqual([`${rid}-DC01`, `${rid}-W1125H2`])
    expect(resolveLimitHostForRangeVm(`${rid}-GOAD-DC01`, yaml, rid)).toBe(`${rid}-DC01`)
  })

  it("extracts inventory text from Ludus envelope", () => {
    expect(extractInventoryText({ result: "[all]\nhost1" })).toBe("[all]\nhost1")
    expect(extractInventoryText("plain")).toBe("plain")
  })

  it("merges inventory over config hosts", () => {
    expect(mergeDeployLimitHosts(["a", "b"], ["c"])).toEqual(["c"])
    expect(mergeDeployLimitHosts(["a"], [])).toEqual(["a"])
  })

  it("builds comma-separated limit pattern", () => {
    expect(buildDeployLimitPattern(["ws01", "dc01"])).toBe("dc01,ws01")
    expect(buildDeployLimitPattern([])).toBeUndefined()
  })

  it("prefers custom pattern over checkbox selection", () => {
    expect(resolveDeployLimitPattern(["dc01"], "windows")).toBe("windows")
    expect(resolveDeployLimitPattern(["dc01"], "")).toBe("dc01")
  })
})
