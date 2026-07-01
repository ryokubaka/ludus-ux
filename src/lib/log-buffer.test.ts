import { describe, expect, it } from "vitest"
import {
  appendStreamLines,
  appendAppLogStreamLines,
  prependAppLogHistoryLines,
  parseAppLogLineTs,
  MAX_STREAM_LOG_LINES,
  MAX_APP_LOG_STREAM_LINES,
  MAX_APP_LOG_LOADED_LINES,
} from "./log-buffer"

describe("appendStreamLines", () => {
  it("appends a string chunk", () => {
    expect(appendStreamLines(["a"], "b")).toEqual(["a", "b"])
  })

  it("appends an array chunk", () => {
    expect(appendStreamLines(["a"], ["b", "c"])).toEqual(["a", "b", "c"])
  })

  it("trims to MAX_STREAM_LOG_LINES when exceeded", () => {
    const prev = Array.from({ length: MAX_STREAM_LOG_LINES }, (_, i) => `line-${i}`)
    const result = appendStreamLines(prev, "overflow")
    expect(result).toHaveLength(MAX_STREAM_LOG_LINES)
    expect(result[result.length - 1]).toBe("overflow")
    expect(result[0]).toBe("line-1")
  })
})

describe("appendAppLogStreamLines", () => {
  it("appends lines up to the limit", () => {
    expect(appendAppLogStreamLines(["a"], "b")).toEqual(["a", "b"])
  })

  it("trims to MAX_APP_LOG_STREAM_LINES", () => {
    const prev = Array.from({ length: MAX_APP_LOG_STREAM_LINES }, (_, i) => `line-${i}`)
    const result = appendAppLogStreamLines(prev, "new")
    expect(result).toHaveLength(MAX_APP_LOG_STREAM_LINES)
    expect(result[result.length - 1]).toBe("new")
  })
})

describe("prependAppLogHistoryLines", () => {
  it("prepends older lines", () => {
    expect(prependAppLogHistoryLines(["b"], ["a"])).toEqual(["a", "b"])
  })

  it("returns prev unchanged when older is empty", () => {
    const prev = ["a", "b"]
    expect(prependAppLogHistoryLines(prev, [])).toBe(prev)
  })

  it("trims to MAX_APP_LOG_LOADED_LINES from the front", () => {
    const prev = Array.from({ length: MAX_APP_LOG_LOADED_LINES }, (_, i) => `p-${i}`)
    const result = prependAppLogHistoryLines(prev, ["old"])
    expect(result).toHaveLength(MAX_APP_LOG_LOADED_LINES)
    expect(result[0]).toBe("old")
  })
})

describe("parseAppLogLineTs", () => {
  it("parses ISO timestamp from bracketed prefix", () => {
    const ts = parseAppLogLineTs("[2024-06-15T10:30:00Z] some log line")
    expect(ts).toBe(Date.parse("2024-06-15T10:30:00Z"))
  })

  it("returns null for lines without brackets", () => {
    expect(parseAppLogLineTs("no brackets here")).toBeNull()
  })

  it("returns null for unparseable timestamp", () => {
    expect(parseAppLogLineTs("[not-a-date] text")).toBeNull()
  })
})
