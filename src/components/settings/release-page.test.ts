import { describe, expect, it } from "vitest"
import { releasePageCount, releasePageIndex, releasePageRange, releasePageSlice } from "@/components/settings/release-page"

describe("release pages", () => {
  const tags = Array.from({ length: 25 }, (_, i) => `v${i}`)

  it("shows ten releases and a remainder page", () => {
    expect(releasePageCount(25)).toBe(3)
    expect(releasePageSlice(tags, 0)).toEqual(tags.slice(0, 10))
    expect(releasePageSlice(tags, 2)).toEqual(tags.slice(20))
    expect(releasePageRange(25, 2)).toEqual({ from: 21, to: 25, page: 2, pages: 3 })
  })

  it("keeps a short list on one page", () => {
    expect(releasePageCount(10)).toBe(1)
    expect(releasePageCount(0)).toBe(1)
    expect(releasePageSlice(tags.slice(0, 4), 0)).toHaveLength(4)
    expect(releasePageRange(0, 3)).toEqual({ from: 0, to: 0, page: 0, pages: 1 })
  })

  it("clamps a page past either end", () => {
    expect(releasePageIndex(25, -1)).toBe(0)
    expect(releasePageIndex(25, 9)).toBe(2)
    expect(releasePageSlice(tags, 9)).toEqual(tags.slice(20))
  })
})
