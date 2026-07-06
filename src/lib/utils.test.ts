import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"
import {
  formatDate,
  timeAgo,
  formatElapsed,
  extractArray,
  extractLudusList,
  parseLudusGroupList,
  getRangeStateBadge,
} from "./utils"

describe("formatDate", () => {
  it("returns 'Never' for undefined", () => {
    expect(formatDate(undefined)).toBe("Never")
  })

  it("formats a valid ISO string", () => {
    const result = formatDate("2024-06-15T10:30:00Z")
    expect(result).toMatch(/Jun 15, 2024/)
  })

  it("formats a Date object", () => {
    // Construct from local components so the assertion is timezone-independent.
    const result = formatDate(new Date(2024, 0, 1, 0, 0, 0))
    expect(result).toMatch(/Jan 01, 2024/)
  })

  it("returns stringified value for invalid date", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date")
  })
})

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 'just now' for recent timestamps", () => {
    const now = Date.now()
    expect(timeAgo(now - 30_000)).toBe("just now")
  })

  it("returns minutes ago", () => {
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe("5m ago")
  })

  it("returns hours ago", () => {
    expect(timeAgo(Date.now() - 3 * 3_600_000)).toBe("3h ago")
  })

  it("returns stringified input for NaN", () => {
    expect(timeAgo("garbage")).toBe("garbage")
  })

  it("returns stringified input for future timestamps", () => {
    const future = Date.now() + 60_000
    expect(timeAgo(future)).toBe(String(future))
  })

  it("accepts a Date object", () => {
    expect(timeAgo(new Date(Date.now() - 120_000))).toBe("2m ago")
  })

  it("accepts epoch millis", () => {
    expect(timeAgo(Date.now() - 30_000)).toBe("just now")
  })
})

describe("formatElapsed", () => {
  it("formats zero", () => {
    expect(formatElapsed(0)).toBe("0s")
  })

  it("formats seconds only", () => {
    expect(formatElapsed(45_000)).toBe("45s")
  })

  it("formats minutes and seconds", () => {
    expect(formatElapsed(90_000)).toBe("1m 30s")
  })

  it("formats hours and minutes", () => {
    expect(formatElapsed(3_720_000)).toBe("1h 2m")
  })
})

describe("extractArray", () => {
  it("returns array as-is", () => {
    expect(extractArray([1, 2, 3])).toEqual([1, 2, 3])
  })

  it("unwraps { result: [...] }", () => {
    expect(extractArray({ result: [4, 5] })).toEqual([4, 5])
  })

  it("returns [] for non-array result", () => {
    expect(extractArray({ result: "not-array" })).toEqual([])
  })

  it("returns [] for null", () => {
    expect(extractArray(null)).toEqual([])
  })

  it("returns [] for primitive", () => {
    expect(extractArray(42)).toEqual([])
  })
})

describe("extractLudusList", () => {
  it("returns bare array", () => {
    expect(extractLudusList([1, 2])).toEqual([1, 2])
  })

  it("unwraps { result: [...] }", () => {
    expect(extractLudusList({ result: [3] })).toEqual([3])
  })

  it("unwraps { blueprints: [...] }", () => {
    expect(extractLudusList({ blueprints: [{ id: "a" }] })).toEqual([{ id: "a" }])
  })

  it("unwraps { templates: [...] }", () => {
    expect(extractLudusList({ templates: ["t1"] })).toEqual(["t1"])
  })

  it("supports extra keys", () => {
    expect(extractLudusList({ custom: [99] }, ["custom"])).toEqual([99])
  })

  it("returns [] for null", () => {
    expect(extractLudusList(null)).toEqual([])
  })

  it("returns [] for non-object", () => {
    expect(extractLudusList("string")).toEqual([])
  })

  it("recursively unwraps nested objects", () => {
    expect(extractLudusList({ result: { data: [1, 2] } })).toEqual([1, 2])
  })
})

describe("parseLudusGroupList", () => {
  it("returns bare array", () => {
    expect(parseLudusGroupList([{ id: 1 }])).toEqual([{ id: 1 }])
  })

  it("unwraps { result: [...] }", () => {
    expect(parseLudusGroupList({ result: [{ id: 2 }] })).toEqual([{ id: 2 }])
  })

  it("wraps single result object in array", () => {
    expect(parseLudusGroupList({ result: { id: 3 } })).toEqual([{ id: 3 }])
  })

  it("unwraps { groups: [...] }", () => {
    expect(parseLudusGroupList({ groups: [{ name: "g1" }] })).toEqual([{ name: "g1" }])
  })

  it("unwraps { items: [...] }", () => {
    expect(parseLudusGroupList({ items: [{ name: "i1" }] })).toEqual([{ name: "i1" }])
  })

  it("returns [] for null", () => {
    expect(parseLudusGroupList(null)).toEqual([])
  })

  it("returns [] for non-array result value", () => {
    expect(parseLudusGroupList({ result: 42 })).toEqual([])
  })
})

describe("getRangeStateBadge", () => {
  it("returns success classes", () => {
    expect(getRangeStateBadge("SUCCESS")).toContain("text-status-success")
  })

  it("returns warning classes for DEPLOYING", () => {
    expect(getRangeStateBadge("DEPLOYING")).toContain("text-status-warning")
  })

  it("returns error classes for ERROR", () => {
    expect(getRangeStateBadge("ERROR")).toContain("text-status-error")
  })

  it("returns aborted classes", () => {
    expect(getRangeStateBadge("ABORTED")).toContain("text-status-aborted")
  })

  it("returns neutral classes for unknown state", () => {
    expect(getRangeStateBadge("UNKNOWN")).toContain("text-status-neutral")
  })
})
