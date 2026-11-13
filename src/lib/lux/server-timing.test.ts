import { describe, expect, it, afterEach } from "vitest"
import { serverTimingHeader } from "@/lib/lux/server-timing"

const original = process.env.LUX_SERVER_TIMING

afterEach(() => {
  if (original === undefined) delete process.env.LUX_SERVER_TIMING
  else process.env.LUX_SERVER_TIMING = original
})

describe("serverTimingHeader", () => {
  it("formats fixed-token phase durations", () => {
    const header = serverTimingHeader({ auth: 12.4, upstream: 345.9, total: 400 })
    expect(header).toBe("auth;dur=12, upstream;dur=346, total;dur=400")
  })

  it("includes a cache status descriptor", () => {
    const header = serverTimingHeader({
      auth: 1,
      cache: { dur: 0, desc: "hit" },
      total: 2,
    })
    expect(header).toBe("auth;dur=1, cache;dur=0;desc=hit, total;dur=2")
  })

  it("drops an invalid descriptor without dropping the phase", () => {
    const header = serverTimingHeader({ cache: { dur: 0, desc: "bad value" } })
    expect(header).toBe("cache;dur=0")
  })

  it("skips invalid values and metric names", () => {
    const header = serverTimingHeader({ auth: Number.NaN, "bad name": 4, upstream: 10 })
    expect(header).toBe("upstream;dur=10")
  })

  it("returns null when disabled", () => {
    process.env.LUX_SERVER_TIMING = "0"
    expect(serverTimingHeader({ auth: 1 })).toBeNull()
  })
})
