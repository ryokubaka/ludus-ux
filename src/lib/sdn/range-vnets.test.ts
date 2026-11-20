import { describe, expect, it } from "vitest"
import {
  ageingProbeCommand,
  hubAgeingWriteCommand,
  aliasUpdates,
  bridgesNeedingHub,
  guestPortProbeCommand,
  parseAgeingProbe,
  parseGuestPortProbe,
  parseSdnVnetPayload,
  planRangeVnets,
  proxmoxApiBase,
  rangeConfigNeedsHubMode,
  rangeHubBridges,
  sdnApplyIsSafe,
} from "@/lib/sdn/range-vnets"

const ranges = [
  { rangeID: "ludusadmin", rangeNumber: 2 },
  { rangeID: "seconion33", rangeNumber: 4 },
  { rangeID: "SO33", rangeNumber: 6 },
]

const vnets = parseSdnVnetPayload({
  data: [
    { vnet: "ludusnat", zone: "ludus", alias: null, tag: 16777215 },
    { vnet: "r1", zone: "ludus", alias: null, tag: "1" },
    { vnet: "r2", zone: "ludus", alias: null, tag: 2 },
    { vnet: "r4", zone: "ludus", alias: null, tag: 4 },
    { vnet: "r6", zone: "ludus", alias: "SO33", tag: 6 },
  ],
})

describe("planRangeVnets", () => {
  it("ties rN to the one range with that number and leaves the alias to be filled", () => {
    const plan = planRangeVnets(ranges, vnets)
    expect(plan.orphans.map((row) => row.vnet)).toEqual(["r1"])
    expect(plan.unmanaged.map((row) => row.vnet)).toEqual(["ludusnat"])
    expect(plan.tied.find((row) => row.vnet === "r4")).toMatchObject({
      rangeID: "seconion33",
      aliasMatches: false,
      tagMatches: true,
    })
    expect(plan.tied.find((row) => row.vnet === "r6")?.aliasMatches).toBe(true)
    expect(aliasUpdates(plan).map((row) => row.vnet).sort()).toEqual(["r2", "r4"])
  })

  it("does not treat an ambiguous range number as an orphan", () => {
    const plan = planRangeVnets(
      [
        { rangeID: "one", rangeNumber: 4 },
        { rangeID: "two", rangeNumber: 4 },
      ],
      [{ vnet: "r4", zone: "ludus", alias: null, tag: 4 }],
    )
    expect(plan.orphans).toEqual([])
    expect(plan.unresolved).toEqual([
      { vnet: "r4", rangeNumber: 4, rangeIDs: ["one", "two"] },
    ])
    expect(aliasUpdates(plan)).toEqual([])
  })
})

describe("rangeConfigNeedsHubMode", () => {
  it("matches the Security Onion role and template", () => {
    expect(rangeConfigNeedsHubMode("roles:\n  - ryokubaka.ludus_securityonion\n")).toBe(true)
    expect(rangeConfigNeedsHubMode("template: securityonion-3.3\n")).toBe(true)
    expect(rangeConfigNeedsHubMode("template: win11-22h2-x64\n")).toBe(false)
  })
})

describe("proxmoxApiBase", () => {
  it("rewrites loopback to the SSH host and keeps a remote URL", () => {
    expect(proxmoxApiBase("https://127.0.0.1:8006", "10.0.20.200")).toBe(
      "https://10.0.20.200:8006/api2/json",
    )
    expect(proxmoxApiBase("https://10.0.20.200:8006/api2/json", "ignored")).toBe(
      "https://10.0.20.200:8006/api2/json",
    )
  })
})

describe("range hub bridges", () => {
  it("names the cluster vnet and the standalone vmbr for one range", () => {
    expect(rangeHubBridges(4)).toEqual(["r4", "vmbr1004"])
    expect(rangeHubBridges(0)).toEqual([])
  })

  it("refreshes a bridge that exists and is not already a hub", () => {
    expect(bridgesNeedingHub({ r4: 0, vmbr1004: 30000 })).toEqual(["vmbr1004"])
    expect(bridgesNeedingHub({ r4: 30000 })).toEqual(["r4"])
    expect(bridgesNeedingHub({})).toEqual([])
  })
})

describe("guest and ageing probes", () => {
  it("rejects a bridge name that is not a range bridge", () => {
    expect(() => guestPortProbeCommand(["r4;rm"])).toThrow(/range bridge name/)
    expect(() => ageingProbeCommand(["vmbr0"])).toThrow(/range bridge name/)
    expect(() => ageingProbeCommand(["vmbr1000"])).toThrow(/range bridge name/)
    expect(() => hubAgeingWriteCommand("vmbr0")).toThrow(/range bridge name/)
    expect(() => hubAgeingWriteCommand("vmbr1002;id")).toThrow(/range bridge name/)
    const write = hubAgeingWriteCommand("vmbr1002")
    expect(write).toContain("/sys/class/net/vmbr1002/bridge/ageing_time")
    expect(write).not.toContain("vmbr1001")
    expect(write).not.toContain("ifreload")
  })

  it("counts guest taps and ignores the vxlan uplink", () => {
    const command = guestPortProbeCommand(["r4", "vmbr1004"])
    expect(command).toContain("/sys/class/net/r4/brif")
    expect(command).toContain("/sys/class/net/vmbr1004/brif")
    expect(command).not.toContain("r4;rm")
    expect(parseGuestPortProbe("r4 tap120i0\nr4 vxlan_r4\nvmbr1004 tap118i0\n")).toEqual({
      r4: ["tap120i0"],
      vmbr1004: ["tap118i0"],
    })
    expect(parseAgeingProbe("r4 30000\nvmbr1004 0\n")).toEqual({ r4: 30000, vmbr1004: 0 })
  })

  it("allows an SDN reload only when no range vnet has a guest port", () => {
    expect(sdnApplyIsSafe({ r1: [], r4: [] })).toBe(true)
    expect(sdnApplyIsSafe({ r4: ["tap120i0"] })).toBe(false)
  })
})
