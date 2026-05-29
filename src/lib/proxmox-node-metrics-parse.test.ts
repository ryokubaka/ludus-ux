import { describe, expect, it } from "vitest"
import {
  fractionToPct,
  parseClusterResourceNodes,
  parseNodeStatusLoad,
} from "./proxmox-node-metrics-parse"

describe("fractionToPct", () => {
  it("converts 0–1 fraction to percent", () => {
    expect(fractionToPct(0.052)).toBe(5.2)
    expect(fractionToPct(0)).toBe(0)
  })

  it("accepts percent-style values over 1", () => {
    expect(fractionToPct(42.5)).toBe(42.5)
  })
})

describe("parseClusterResourceNodes", () => {
  it("reads node cpu and mem from cluster resources", () => {
    const raw = JSON.stringify([
      { type: "node", node: "pve1", cpu: 0.15, mem: 8e9, maxmem: 32e9 },
      { type: "qemu", node: "pve1", cpu: 0.5, vmid: 100 },
    ])
    const map = parseClusterResourceNodes(raw)
    expect(map.get("pve1")).toEqual({ cpuPct: 15, memPct: 25 })
  })
})

describe("parseNodeStatusLoad", () => {
  it("reads loadavg from node status", () => {
    const raw = JSON.stringify({ loadavg: ["1.25", "0.98", "0.50"] })
    expect(parseNodeStatusLoad(raw)).toBe(1.25)
  })
})
