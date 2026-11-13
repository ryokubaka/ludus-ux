import { describe, expect, it, vi } from "vitest"
import { createHostResourcesCache } from "@/lib/proxmox/host-resources-cache"
import type { HostResourceNode } from "@/lib/proxmox/host-resources"

function node(name: string): HostResourceNode {
  return {
    name,
    cpuPct: 12,
    memPct: 34,
    memBytes: 4 * 1024 ** 3,
    maxMemBytes: 16 * 1024 ** 3,
    maxCpu: 8,
  }
}

describe("createHostResourcesCache", () => {
  it("reads on cold start and reuses the snapshot within the refresh window", async () => {
    let now = 1_000_000
    const read = vi.fn(async () => [node("pve1")])
    const cache = createHostResourcesCache({ read, now: () => now })

    const first = await cache.get()
    expect(first?.nodes.map((n) => n.name)).toEqual(["pve1"])
    expect(first?.capturedAt).toBe(1_000_000)
    expect(first?.refreshing).toBe(false)
    expect(first?.error).toBeUndefined()

    now += 5_000
    const second = await cache.get()
    expect(second?.capturedAt).toBe(first?.capturedAt)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("serves a stale snapshot immediately and refreshes it in the background", async () => {
    let now = 1_000_000
    const read = vi.fn(async () => [node("pve1")])
    const cache = createHostResourcesCache({ read, now: () => now })

    await cache.get()
    now += 16_000

    const stale = await cache.get()
    expect(stale?.capturedAt).toBe(1_000_000)
    expect(stale?.refreshing).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)

    await cache.idle()
    const refreshed = await cache.get()
    expect(refreshed?.capturedAt).toBe(1_016_000)
    expect(refreshed?.refreshing).toBe(false)
  })

  it("keeps the last snapshot and reports the refresh error when SSH fails", async () => {
    let now = 1_000_000
    let fail = false
    const read = vi.fn(async () => {
      if (fail) throw new Error("ssh down")
      return [node("pve1")]
    })
    const cache = createHostResourcesCache({ read, now: () => now })

    await cache.get()
    fail = true
    now += 16_000

    const stale = await cache.get()
    expect(stale?.refreshing).toBe(true)
    await cache.idle()

    const after = await cache.get()
    expect(after?.capturedAt).toBe(1_000_000)
    expect(after?.nodes).toHaveLength(1)
    expect(after?.error).toBe("ssh down")
    expect(after?.refreshing).toBe(false)
  })

  it("returns null on a cold failure and backs off before retrying", async () => {
    let now = 1_000_000
    const read = vi.fn(async () => {
      throw new Error("ssh down")
    })
    const cache = createHostResourcesCache({ read, now: () => now })

    expect(await cache.get()).toBeNull()
    expect(cache.lastError()).toBe("ssh down")
    expect(read).toHaveBeenCalledTimes(1)

    now += 5_000
    expect(await cache.get()).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)

    now += 6_000
    expect(await cache.get()).toBeNull()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("reports cache status and read time for route timing", async () => {
    let now = 1_000_000
    const read = vi.fn(async () => [node("pve1")])
    const cache = createHostResourcesCache({ read, now: () => now })

    const cold = await cache.getWithMeta()
    expect(cold.cacheStatus).toBe("miss")
    expect(cold.payload?.nodes.map((n) => n.name)).toEqual(["pve1"])

    now += 5_000
    const hit = await cache.getWithMeta()
    expect(hit.cacheStatus).toBe("hit")
    expect(hit.readMs).toBe(0)

    now += 11_000
    const stale = await cache.getWithMeta()
    expect(stale.cacheStatus).toBe("stale")
    expect(stale.payload?.capturedAt).toBe(1_000_000)
    await cache.idle()
  })

  it("peek never blocks and warms the cache in the background", async () => {
    const read = vi.fn(async () => [node("pve1")])
    const cache = createHostResourcesCache({ read, now: () => 1_000_000 })

    expect(cache.peek()).toBeNull()
    await cache.idle()

    const peeked = cache.peek()
    expect(peeked?.nodes.map((n) => n.name)).toEqual(["pve1"])
    expect(peeked?.refreshing).toBe(false)
  })
})
