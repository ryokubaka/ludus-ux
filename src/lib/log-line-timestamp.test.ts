import { describe, expect, it } from "vitest"
import { augmentLudusDeployHistoryLines, isBlankDeployLogLine, omitBlankLogLines } from "./log-line-timestamp"
import { formatInstantForDeployLog } from "./ludus-wall-clock-bridge"

describe("isBlankDeployLogLine", () => {
  it("treats ansible separators and poll-stamped blanks as empty", () => {
    expect(isBlankDeployLogLine("")).toBe(true)
    expect(isBlankDeployLogLine("   ")).toBe(true)
    expect(isBlankDeployLogLine("[LUDUS] [2026-09-30T18:19:44 EDT] ")).toBe(true)
    expect(isBlankDeployLogLine("[GOAD] [2026-09-30T18:19:44 EDT] ")).toBe(true)
  })

  it("keeps real task lines", () => {
    expect(isBlankDeployLogLine("[LUDUS] [2026-09-30T17:40:51 EDT] PLAY [Pre run checks]")).toBe(false)
    expect(isBlankDeployLogLine("TASK [Check for Proxmox token]")).toBe(false)
  })

  it("drops blank lines from a deploy log", () => {
    expect(omitBlankLogLines(["PLAY [x]", "", "ok: [host]", "  "])).toEqual(["PLAY [x]", "ok: [host]"])
  })
})

describe("augmentLudusDeployHistoryLines", () => {
  it("does not stamp a still-running log past now", () => {
    const startMs = Date.parse("2026-09-30T20:23:03.000Z")
    const now = startMs + 30_000
    const lines = Array.from({ length: 90 }, (_, i) => `line ${i}`)
    const out = augmentLudusDeployHistoryLines(
      lines,
      new Date(startMs).toISOString(),
      "",
      now,
    )
    expect(out[0]?.startsWith(`[${formatInstantForDeployLog(startMs)}]`)).toBe(true)
    expect(out[out.length - 1]?.startsWith(`[${formatInstantForDeployLog(now)}]`)).toBe(true)
  })

  it("keeps a finished log inside its real start and end", () => {
    const startMs = Date.parse("2026-09-30T20:00:00.000Z")
    const endMs = startMs + 10 * 60_000
    const now = endMs + 60_000
    const out = augmentLudusDeployHistoryLines(
      ["a", "b", "c"],
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
      now,
    )
    expect(out[0]?.startsWith(`[${formatInstantForDeployLog(startMs)}]`)).toBe(true)
    expect(out[2]?.startsWith(`[${formatInstantForDeployLog(endMs)}]`)).toBe(true)
  })
})
