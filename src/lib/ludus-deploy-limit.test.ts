import { describe, expect, it } from "vitest"
import {
  buildDeployLimitPattern,
  expandDeployLimitHosts,
  extractInventoryText,
  filterRouterFromDeployLimitHosts,
  mergeDeployLimitHosts,
  limitHostsFromRangeVms,
  normalizeLimitHostForDeploy,
  parseAnsibleInventoryFromLudusPayload,
  parseAnsibleInventoryHosts,
  parseHostsFromRangeConfig,
  parseSelectableDeployLimitHosts,
  resolveLimitHostForRangeVm,
  resolveDeployLimitPattern,
  resolveRangeIdInHost,
  resolveRouterLimitVmNameForDeploy,
  selectableLimitHostsFromRangeVms,
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

  it("uses vm_name when it differs from hostname", () => {
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
    const rid = "lab1-GOAD-Min1-A1B2C3"
    expect(parseHostsFromRangeConfig(yaml, rid)).toEqual([
      `${rid}-GOAD-DC01`,
      `${rid}-GOAD-W11-25H2`,
      `${rid}-KALI-OPS`,
      `${rid}-router`,
      `${rid}-VELOCIRAPTOR`,
    ])
  })

  it("uses explicit router block vm_name from config", () => {
    const yaml = `
ludus:
  - vm_name: "{{ range_id }}-dc01"
    hostname: "{{ range_id }}-dc01"
router:
  vm_name: "{{ range_id }}-router-debian12-x64"
  hostname: "{{ range_id }}-gw"
`
    expect(parseHostsFromRangeConfig(yaml, "lab")).toEqual(["lab-dc01", "lab-router-debian12-x64"])
  })

  it("maps default debian router vm name to {range_id}-router on sync", () => {
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

  it("passes through GET /range vm names for limit host list", () => {
    const yaml = `
ludus:
  - vm_name: '{{ range_id }}-GOAD-DC01'
    hostname: '{{ range_id }}-DC01'
  - vm_name: '{{ range_id }}-GOAD-W11-25H2'
    hostname: '{{ range_id }}-W1125H2'
`
    const rid = "lab"
    expect(
      limitHostsFromRangeVms(
        [{ name: `${rid}-GOAD-DC01` }, { name: `${rid}-GOAD-W11-25H2` }],
        yaml,
        rid,
      ),
    ).toEqual([`${rid}-GOAD-DC01`, `${rid}-GOAD-W11-25H2`])
    expect(resolveLimitHostForRangeVm(`${rid}-GOAD-DC01`, yaml, rid)).toBe(`${rid}-GOAD-DC01`)
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

  it("auto-includes router vm_name when limiting to a single VM", () => {
    const rid = "lab1-GOAD-Mini-RQL64E"
    const yaml = `
ludus:
  - vm_name: '{{ range_id }}-GOAD-W11-25H2'
    hostname: '{{ range_id }}-W1125H2'
`
    const w11 = `${rid}-GOAD-W11-25H2`
    const router = `${rid}-router-debian11-x64`
    expect(
      resolveDeployLimitPattern([w11], "", {
        rangeId: rid,
        configYaml: yaml,
        deployedVms: [{ name: router }, { name: w11 }],
      }),
    ).toBe(`${w11},${router}`)
  })

  it("normalizes router shorthand to Proxmox vm_name for deploy limit", () => {
    const rid = "lab"
    expect(
      normalizeLimitHostForDeploy(`${rid}-router`, "", rid, [
        { name: `${rid}-router-debian12-x64` },
      ]),
    ).toBe(`${rid}-router-debian12-x64`)
    expect(resolveRouterLimitVmNameForDeploy("", rid)).toBe(`${rid}-router-debian11-x64`)
  })

  it("expandDeployLimitHosts appends router when missing", () => {
    const rid = "lab"
    expect(
      expandDeployLimitHosts([`${rid}-GOAD-DC01`], "", rid, [
        { name: `${rid}-router-debian11-x64` },
      ]),
    ).toEqual([`${rid}-GOAD-DC01`, `${rid}-router-debian11-x64`])
  })

  it("omits router from selectable deploy limit host lists", () => {
    const yaml = `
ludus:
  - vm_name: "{{ range_id }}-dc01"
    hostname: "{{ range_id }}-dc01"
  - vm_name: "{{ range_id }}-ws01"
    hostname: "{{ range_id }}-ws01"
`
    expect(parseSelectableDeployLimitHosts(yaml, "myrange")).toEqual([
      "myrange-dc01",
      "myrange-ws01",
    ])
    expect(
      selectableLimitHostsFromRangeVms(
        [
          { name: "myrange-dc01" },
          { name: "myrange-router-debian11-x64" },
          { name: "myrange-ws01" },
        ],
        yaml,
        "myrange",
      ),
    ).toEqual(["myrange-dc01", "myrange-ws01"])
  })

  it("filterRouterFromDeployLimitHosts drops explicit router vm_name", () => {
    const rid = "lab"
    const yaml = `
ludus:
  - vm_name: "{{ range_id }}-dc01"
router:
  vm_name: "{{ range_id }}-router-debian12-x64"
`
    expect(filterRouterFromDeployLimitHosts(parseHostsFromRangeConfig(yaml, rid), yaml, rid)).toEqual([
      `${rid}-dc01`,
    ])
  })
})
