import { describe, expect, it, vi, beforeEach } from "vitest"
import { clearRangeVmsAndWait } from "./wait-range-vms-cleared"

vi.mock("@/lib/api", () => ({
  ludusApi: {
    getRangeStatus: vi.fn(),
    deleteRangeVMs: vi.fn(),
  },
}))

import { ludusApi } from "@/lib/api"

describe("clearRangeVmsAndWait", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("skips delete when range already has no VMs", async () => {
    vi.mocked(ludusApi.getRangeStatus).mockResolvedValue({
      data: { VMs: [] },
      status: 200,
    })
    const result = await clearRangeVmsAndWait("lab-range")
    expect(result).toEqual({ ok: true, hadVms: false })
    expect(ludusApi.deleteRangeVMs).not.toHaveBeenCalled()
  })

  it("deletes and polls until VM list is empty", async () => {
    vi.mocked(ludusApi.getRangeStatus)
      .mockResolvedValueOnce({ data: { VMs: [{}, {}] }, status: 200 })
      .mockResolvedValueOnce({ data: { VMs: [{}] }, status: 200 })
      .mockResolvedValueOnce({ data: { VMs: [] }, status: 200 })
    vi.mocked(ludusApi.deleteRangeVMs).mockResolvedValue({ status: 201 })

    const result = await clearRangeVmsAndWait("lab-range", { pollMs: 1, maxWaitMs: 5_000 })
    expect(result).toEqual({ ok: true, hadVms: true })
    expect(ludusApi.deleteRangeVMs).toHaveBeenCalledWith("lab-range")
  })
})
