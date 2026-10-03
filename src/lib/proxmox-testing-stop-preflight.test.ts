import { describe, expect, it } from "vitest"
import {
  LUDUS_TESTING_CLEAN_SNAPSHOT,
  buildQmConfigShell,
  buildTestingStartEfiEnrollShell,
  buildTestingStopVmEnrollShell,
  buildTestingStopVmRollbackShell,
  efiDiskNeedsMsCert2023,
  formatTestingStopEfiShutdownNotice,
  parseClusterVmidNodeMap,
} from "./proxmox-testing-stop-preflight"

describe("parseClusterVmidNodeMap", () => {
  it("maps qemu vmids to nodes", () => {
    const json = JSON.stringify([
      { vmid: 217, node: "pve1", type: "qemu" },
      { vmid: 100, node: "pve2", type: "lxc" },
      { vmid: "218", node: "pve1", type: "qemu" },
    ])
    const map = parseClusterVmidNodeMap(json)
    expect(map.get(217)).toBe("pve1")
    expect(map.get(218)).toBe("pve1")
    expect(map.has(100)).toBe(false)
  })

  it("returns empty map on bad json", () => {
    expect(parseClusterVmidNodeMap("not-json").size).toBe(0)
  })
})

describe("efiDiskNeedsMsCert2023", () => {
  it("true when efidisk present without ms-cert=2023k", () => {
    expect(
      efiDiskNeedsMsCert2023(
        "boot: order=scsi0;ide2;net0\nefidisk0: local-lvm:vm-217-disk-1,efitype=4m,pre-enrolled-keys=1,size=4M\nscsi0: local-lvm:vm-217-disk-0\n",
      ),
    ).toBe(true)
  })

  it("false when ms-cert=2023k already on efidisk", () => {
    expect(
      efiDiskNeedsMsCert2023(
        "efidisk0: local-lvm:vm-217-disk-1,efitype=4m,ms-cert=2023k,pre-enrolled-keys=1,size=4M\n",
      ),
    ).toBe(false)
  })

  it("false when no EFI disk", () => {
    expect(efiDiskNeedsMsCert2023("scsi0: local-lvm:vm-100-disk-0\n")).toBe(false)
  })
})

describe("buildTestingStartEfiEnrollShell / rollback / enroll", () => {
  it("start enroll shell stops, enrolls, verifies; restarts when requested", () => {
    expect(buildTestingStartEfiEnrollShell(217, "pve1", { restart: true })).toEqual([
      "testing-enroll",
      "217",
      "pve1",
      "1",
    ])
  })

  it("start enroll shell leaves VM stopped when restart false", () => {
    expect(buildTestingStartEfiEnrollShell(217, "pve1", { restart: false })).toEqual([
      "testing-enroll",
      "217",
      "pve1",
      "0",
    ])
  })

  it("rollback shell stops and rolls back without enroll", () => {
    expect(buildTestingStopVmRollbackShell(217, "pve1", LUDUS_TESTING_CLEAN_SNAPSHOT)).toEqual([
      "testing-rollback",
      "217",
      "pve1",
      LUDUS_TESTING_CLEAN_SNAPSHOT,
    ])
  })

  it("enroll shell enrolls after stop and checks ms-cert marker", () => {
    expect(buildTestingStopVmEnrollShell(217, "pve1")).toEqual([
      "testing-enroll",
      "217",
      "pve1",
      "0",
    ])
  })

  it("rejects unsafe node or snapname", () => {
    expect(() => buildTestingStartEfiEnrollShell(1, "pve;rm", { restart: false })).toThrow(
      /invalid node/,
    )
    expect(() => buildTestingStopVmRollbackShell(1, "pve;rm", "snap")).toThrow(/invalid node/)
    expect(() => buildTestingStopVmRollbackShell(1, "pve", "snap;rm")).toThrow(/invalid snapname/)
  })
})

describe("buildQmConfigShell", () => {
  it("reads qm config only", () => {
    expect(buildQmConfigShell(217)).toEqual(["qm-config", "217"])
  })
})

describe("dedupeEfiEnrollCandidates / formatTestingStopEfiShutdownNotice", () => {
  it("lists VMs that will power off once per vmid before snapshot", () => {
    const notice = formatTestingStopEfiShutdownNotice([
      { vmid: 217, name: "GOAD-W11-25H2", node: "pve1" },
      { vmid: 217, name: "GOAD-W11-25H2", node: "pve1" },
    ])
    expect(notice).toContain("GOAD-W11-25H2 (217)")
    expect(notice.match(/217/g)?.length).toBe(1)
    expect(notice).toContain("required for snapshot rollback")
    expect(notice).toContain("Then testing snapshots continue")
    expect(notice).not.toContain("before revert")
  })

  it("empty when no candidates", () => {
    expect(formatTestingStopEfiShutdownNotice([])).toBe("")
  })
})

describe("fingerprintRangeVmids / vmFingerprintGainedVms", () => {
  it("sorts and dedupes", async () => {
    const { fingerprintRangeVmids, vmFingerprintGainedVms } = await import(
      "./testing-stop-efi-cache"
    )
    expect(fingerprintRangeVmids([217, 100, 217])).toBe("100,217")
    expect(vmFingerprintGainedVms("100,217", "100,217")).toBe(false)
    expect(vmFingerprintGainedVms("100,217", "100")).toBe(false)
    expect(vmFingerprintGainedVms("100,217", "")).toBe(false)
    expect(vmFingerprintGainedVms("100,217", "100,217,300")).toBe(true)
  })
})
