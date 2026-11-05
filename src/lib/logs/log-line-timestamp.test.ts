import { describe, expect, it } from "vitest"
import { augmentLudusDeployHistoryLines, deployLogClockPrefix, extendDeployLogClock, hashDeployLogLine, isBlankDeployLogLine, omitBlankLogLines, selectDeployLogClock, stampDeployLogForDisplay, stampObservedDeployLines } from "@/lib/logs/log-line-timestamp"
import { formatInstantForDeployLog } from "@/lib/ludus/ludus-wall-clock-bridge"

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
  it("spreads a running log from its start to now", () => {
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
    expect(out[1]?.startsWith(`[${formatInstantForDeployLog(startMs + 1000)}]`)).toBe(false)
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

describe("stampObservedDeployLines", () => {
  it("stamps only lines that arrived after the previous poll", () => {
    const t0 = Date.parse("2026-10-21T14:00:00.000Z")
    const t1 = t0 + 15_000
    const first = stampObservedDeployLines([], ["PLAY [a]", "TASK [b]"], t0)
    const second = stampObservedDeployLines(first, ["PLAY [a]", "TASK [b]", "ok: [h]"], t1)
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[0]?.startsWith(`[${formatInstantForDeployLog(t0)}]`)).toBe(true)
    expect(second[2]?.startsWith(`[${formatInstantForDeployLog(t1)}] ok: [h]`)).toBe(true)
  })

  it("restamps from the first changed line", () => {
    const t0 = Date.parse("2026-10-21T14:00:00.000Z")
    const t1 = t0 + 5_000
    const first = stampObservedDeployLines([], ["one", "two"], t0)
    const second = stampObservedDeployLines(first, ["one", "replaced"], t1)
    expect(second[0]).toBe(first[0])
    expect(second[1]?.startsWith(`[${formatInstantForDeployLog(t1)}] replaced`)).toBe(true)
  })
})

describe("deploy log clock", () => {
  it("does not stamp the backlog, and stamps only lines that arrived later", () => {
    const t0 = Date.parse("2026-10-21T15:00:00.000Z")
    const t1 = t0 + 20_000
    const t2 = t0 + 40_000
    const first = extendDeployLogClock([], ["PLAY [a]", "TASK [b]"], t0)
    const second = extendDeployLogClock(first.entries, ["PLAY [a]", "TASK [b]", "ok: [h]"], t1)
    const third = extendDeployLogClock(second.entries, ["PLAY [a]", "TASK [b]", "ok: [h]", "TASK [next]"], t2)
    expect(second.fresh).toBe(false)
    expect(second.entries[0]?.ms).toBe(0)
    expect(second.entries[2]?.ms).toBe(t1)
    expect(third.entries[3]?.ms).toBe(t2)
    const shown = stampDeployLogForDisplay(
      ["PLAY [a]", "TASK [b]", "ok: [h]", "TASK [next]"],
      [third.entries],
      new Date(t0).toISOString(),
      "",
      t2,
    )
    expect(shown[0]?.startsWith(`[${formatInstantForDeployLog(t0)}]`)).toBe(true)
    expect(shown[2]?.startsWith(`[${formatInstantForDeployLog(t1)}]`)).toBe(false)
    expect(shown[3]?.startsWith(`[${formatInstantForDeployLog(t2)}] TASK [next]`)).toBe(true)
  })

  it("ignores a clock that stamps the whole file at one time", () => {
    const t0 = Date.parse("2026-10-21T15:51:00.000Z")
    const now = t0 + 60_000
    const flat = ["a", "b", "c"].map((line) => ({ h: hashDeployLogLine(line), ms: t0 }))
    const shown = stampDeployLogForDisplay(["a", "b", "c"], [flat], new Date(t0).toISOString(), "", now)
    expect(shown[0]?.startsWith(`[${formatInstantForDeployLog(t0)}]`)).toBe(true)
    expect(shown[2]?.startsWith(`[${formatInstantForDeployLog(now)}]`)).toBe(true)
  })

  it("does not apply a clock that diverges mid-log", () => {
    const t0 = Date.parse("2026-10-21T15:00:00.000Z")
    const older = extendDeployLogClock([], ["PLAY [a]", "TASK [old]"], t0).entries
    const current = extendDeployLogClock([], ["PLAY [a]", "TASK [new]"], t0 + 1000).entries
    const raw = ["PLAY [a]", "TASK [new]", "ok: [h]"]
    expect(selectDeployLogClock(raw, [older, current])).toBe(current)
    expect(deployLogClockPrefix(raw, older)).toBe(1)
  })
})
