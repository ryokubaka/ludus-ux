import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "@/lib/core/concurrency"

describe("mapWithConcurrency", () => {
  it("returns results in input order", async () => {
    const out = await mapWithConcurrency([3, 1, 2], 2, async (value) => value * 10)
    expect(out).toEqual([30, 10, 20])
  })

  it("never exceeds the requested worker count", async () => {
    let active = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return null
    })
    expect(peak).toBe(2)
  })

  it("handles an empty list", async () => {
    const fn = async () => 1
    await expect(mapWithConcurrency([], 4, fn)).resolves.toEqual([])
  })

  it("clamps a limit larger than the input", async () => {
    let peak = 0
    let active = 0
    await mapWithConcurrency([1, 2], 10, async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return null
    })
    expect(peak).toBe(2)
  })
})
