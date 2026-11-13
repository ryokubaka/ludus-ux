import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RangeObject, UserObject } from "@/lib/core/types"

vi.mock("@/lib/range/range-ownership-store", () => ({
  getAllOwnership: vi.fn(() => new Map<string, string>()),
}))
vi.mock("@/lib/core/pocketbase-client", () => ({
  fetchPbAdminData: vi.fn(async () => null),
}))
vi.mock("@/lib/ludus/ludus-client", () => ({ ludusRequest: vi.fn() }))
vi.mock("@/lib/ludus/ludus-cache-revalidate", () => ({
  revalidateLudusAdminMutation: vi.fn(),
}))

import { getAllOwnership } from "@/lib/range/range-ownership-store"
import { fetchPbAdminData } from "@/lib/core/pocketbase-client"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { buildAdminData } from "@/lib/admin/admin-data"

const getAllOwnershipMock = vi.mocked(getAllOwnership)
const fetchPbAdminDataMock = vi.mocked(fetchPbAdminData)
const ludusRequestMock = vi.mocked(ludusRequest)

function range(rangeID: string): RangeObject {
  return { rangeID, VMs: [] } as unknown as RangeObject
}

function user(userID: string): UserObject {
  return { userID } as UserObject
}

describe("admin slow path", () => {
  beforeEach(() => {
    getAllOwnershipMock.mockReturnValue(new Map())
    fetchPbAdminDataMock.mockResolvedValue(null)
    ludusRequestMock.mockReset()
  })

  it("bounds per-range detail concurrency and joins owners", async () => {
    let active = 0
    let maxActive = 0
    const ranges = Array.from({ length: 12 }, (_, i) => range(`range-${i}`))

    ludusRequestMock.mockImplementation(async (path: string) => {
      if (path === "/range/all") return { data: { result: ranges }, status: 200 }
      if (path === "/user/all") return { data: { result: [user("alice")] }, status: 200 }
      if (path.startsWith("/range?rangeID=")) {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        const rangeID = decodeURIComponent(path.split("=")[1] ?? "")
        return { data: { rangeID, userID: "alice" }, status: 200 }
      }
      return { data: undefined, status: 404 }
    })

    const data = await buildAdminData("key")
    expect(Object.keys(data.ownership)).toHaveLength(12)
    expect(maxActive).toBeLessThanOrEqual(6)
    expect(data.partial).toBeUndefined()
  })

  it("reports ranges whose detail lookup failed", async () => {
    const ranges = [range("range-a"), range("range-b")]

    ludusRequestMock.mockImplementation(async (path: string) => {
      if (path === "/range/all") return { data: { result: ranges }, status: 200 }
      if (path === "/user/all") return { data: { result: [user("alice")] }, status: 200 }
      if (path.includes("range-a")) return { data: { rangeID: "range-a", userID: "alice" }, status: 200 }
      if (path.includes("range-b")) return { data: undefined, error: "timeout", status: 0 }
      return { data: undefined, status: 404 }
    })

    const data = await buildAdminData("key")
    expect(data.ownership["range-a"]).toBe("alice")
    expect(data.partial).toEqual({
      unresolvedRangeIDs: ["range-b"],
      truncated: false,
    })
  })

  it("marks skipped detail lookups as partial", async () => {
    const ranges = Array.from({ length: 31 }, (_, i) => range(`range-${i}`))

    ludusRequestMock.mockImplementation(async (path: string) => {
      if (path === "/range/all") return { data: { result: ranges }, status: 200 }
      if (path === "/user/all") return { data: { result: [user("alice")] }, status: 200 }
      if (path.startsWith("/range?rangeID=")) {
        const rangeID = decodeURIComponent(path.split("=")[1] ?? "")
        return { data: { rangeID, userID: "alice" }, status: 200 }
      }
      return { data: undefined, status: 404 }
    })

    const data = await buildAdminData("key")
    expect(data.partial?.truncated).toBe(true)
    expect(data.partial?.unresolvedRangeIDs).toContain("range-30")
  })
})
