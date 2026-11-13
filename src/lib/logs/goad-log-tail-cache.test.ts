import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invalidateGoadLogTail, readGoadLogTail } from "@/lib/logs/goad-log-tail-cache"

describe("readGoadLogTail", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    invalidateGoadLogTail()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("shares one read between concurrent viewers", async () => {
    let release!: (lines: string[]) => void
    const reader = vi.fn(() => new Promise<string[]>((resolve) => { release = resolve }))
    const first = readGoadLogTail("range-1", reader)
    const second = readGoadLogTail("range-1", reader)
    release(["a", "b"])
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, lines: ["a", "b"] },
      { ok: true, lines: ["a", "b"] },
    ])
    expect(reader).toHaveBeenCalledTimes(1)
  })

  it("serves the cached snapshot inside the TTL", async () => {
    const reader = vi.fn(async () => ["a"])
    await readGoadLogTail("range-1", reader)
    await readGoadLogTail("range-1", reader)
    expect(reader).toHaveBeenCalledTimes(1)
  })

  it("retries after the TTL", async () => {
    const reader = vi.fn(async () => ["a"])
    await readGoadLogTail("range-1", reader)
    vi.setSystemTime(new Date("2026-01-01T00:00:03Z"))
    await readGoadLogTail("range-1", reader)
    expect(reader).toHaveBeenCalledTimes(2)
  })

  it("does not cache a failed read", async () => {
    const reader = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("ssh down"))
      .mockResolvedValueOnce(["a"])
    await expect(readGoadLogTail("range-1", reader)).resolves.toEqual({ ok: false })
    await expect(readGoadLogTail("range-1", reader)).resolves.toEqual({ ok: true, lines: ["a"] })
    expect(reader).toHaveBeenCalledTimes(2)
  })

  it("keeps ranges isolated", async () => {
    const reader = vi.fn(async () => ["a"])
    await readGoadLogTail("range-1", reader)
    await readGoadLogTail("range-2", reader)
    expect(reader).toHaveBeenCalledTimes(2)
  })
})
