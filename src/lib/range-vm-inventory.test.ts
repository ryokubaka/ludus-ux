import { describe, expect, it } from "vitest"
import {
  buildRangeVmInventoryRows,
  groupInventoryRowsByRange,
  inventoryRowToVmObject,
  parseVmTemplateMapFromConfig,
  vmMatchesTemplateFilter,
} from "./range-vm-inventory"
import type { RangeObject } from "./types"

const SO_YAML = `
ludus:
  - vm_name: "{{ range_id }}-so"
    template: securityonion-2.4-x64-template
    vlan: 20
`

describe("parseVmTemplateMapFromConfig", () => {
  it("maps resolved vm_name to template", () => {
    const map = parseVmTemplateMapFromConfig(SO_YAML, "catshadowstep")
    expect(map.get("catshadowstep-so")).toBe("securityonion-2.4-x64-template")
  })

  it("includes default router template when router block present", () => {
    const yaml = `
router:
  vm_name: "{{ range_id }}-router-debian11-x64"
ludus: []
`
    const map = parseVmTemplateMapFromConfig(yaml, "lab")
    expect(map.get("lab-router-debian11-x64")).toBe("debian-11-x64-server-template")
  })
})

describe("vmMatchesTemplateFilter", () => {
  it("matches template list name to catalog alias", () => {
    expect(
      vmMatchesTemplateFilter(
        "securityonion-2.4-x64-template",
        "securityonion-2.4",
      ),
    ).toBe(true)
  })

  it("rejects unknown template rows when filtering", () => {
    expect(vmMatchesTemplateFilter("—", "securityonion-2.4-x64-template")).toBe(false)
  })
})

describe("buildRangeVmInventoryRows", () => {
  it("flattens VMs with template from config", () => {
    const ranges: RangeObject[] = [
      {
        rangeID: "catshadowstep",
        name: "Primary",
        rangeNumber: 1,
        rangeState: "DEPLOYED",
        VMs: [
          {
            ID: 1,
            proxmoxID: 113,
            rangeNumber: 1,
            name: "catshadowstep-so",
            poweredOn: true,
            ip: "10.1.20.20",
          },
        ],
      },
    ]
    const rows = buildRangeVmInventoryRows(
      ranges,
      { catshadowstep: SO_YAML },
      { catshadowstep: "catshadowstep" },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].template).toBe("securityonion-2.4-x64-template")
    expect(rows[0].proxmoxID).toBe(113)
    expect(rows[0].ownerUserID).toBe("catshadowstep")
  })
})

describe("groupInventoryRowsByRange", () => {
  it("groups rows by rangeID for Ludus power calls", () => {
    const rows = buildRangeVmInventoryRows(
      [
        {
          rangeID: "a",
          name: "A",
          rangeNumber: 1,
          rangeState: "DEPLOYED",
          VMs: [
            { ID: 1, proxmoxID: 1, rangeNumber: 1, name: "a-vm1", poweredOn: true, ip: "" },
            { ID: 2, proxmoxID: 2, rangeNumber: 1, name: "a-vm2", poweredOn: false, ip: "" },
          ],
        },
        {
          rangeID: "b",
          name: "B",
          rangeNumber: 2,
          rangeState: "DEPLOYED",
          VMs: [{ ID: 3, proxmoxID: 3, rangeNumber: 2, name: "b-vm1", poweredOn: true, ip: "" }],
        },
      ],
      {},
      {},
    )
    const grouped = groupInventoryRowsByRange(rows)
    expect(grouped.get("a")).toHaveLength(2)
    expect(grouped.get("b")).toHaveLength(1)
  })
})

describe("inventoryRowToVmObject", () => {
  it("maps inventory row to VMObject", () => {
    const row = buildRangeVmInventoryRows(
      [
        {
          rangeID: "lab",
          name: "Lab",
          rangeNumber: 1,
          rangeState: "DEPLOYED",
          VMs: [{ ID: 9, proxmoxID: 9, rangeNumber: 1, name: "lab-kali", poweredOn: true, ip: "10.0.0.5" }],
        },
      ],
      {},
      { lab: "user1" },
    )[0]
    expect(inventoryRowToVmObject(row)).toMatchObject({
      name: "lab-kali",
      proxmoxID: 9,
      poweredOn: true,
      ip: "10.0.0.5",
    })
  })
})
