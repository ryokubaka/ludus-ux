import { describe, expect, it } from "vitest"
import { PROBE_BASE_MS, PROBE_MAX_BACKOFF_MS, probeBackoffMs } from "@/lib/logs/probe-backoff"

describe("probeBackoffMs", () => {
  it("retries immediately while healthy", () => {
    expect(probeBackoffMs(0)).toBe(0)
  })

  it("grows with each consecutive failure", () => {
    expect(probeBackoffMs(1)).toBe(PROBE_BASE_MS * 2)
    expect(probeBackoffMs(2)).toBe(PROBE_BASE_MS * 4)
    expect(probeBackoffMs(3)).toBe(PROBE_BASE_MS * 8)
  })

  it("caps the delay so recovery is still noticed", () => {
    expect(probeBackoffMs(10)).toBe(PROBE_MAX_BACKOFF_MS)
    expect(probeBackoffMs(1_000)).toBe(PROBE_MAX_BACKOFF_MS)
  })

  it("treats nonsense input as healthy", () => {
    expect(probeBackoffMs(-1)).toBe(0)
    expect(probeBackoffMs(Number.NaN)).toBe(0)
  })
})
