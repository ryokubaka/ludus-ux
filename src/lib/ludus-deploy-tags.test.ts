import { describe, expect, it } from "vitest"
import { filterLudusDeployTags, LUDUS_DEPLOY_TAGS } from "./ludus-deploy-tags"

describe("filterLudusDeployTags", () => {
  it("returns valid tags unchanged", () => {
    expect(filterLudusDeployTags(["network", "windows"])).toEqual(["network", "windows"])
  })

  it("drops unknown tags", () => {
    expect(filterLudusDeployTags(["network", "invalid-tag", "windows"])).toEqual(["network", "windows"])
  })

  it("deduplicates", () => {
    expect(filterLudusDeployTags(["network", "network"])).toEqual(["network"])
  })

  it("preserves first-seen order", () => {
    expect(filterLudusDeployTags(["windows", "network"])).toEqual(["windows", "network"])
  })

  it("returns empty for all unknown tags", () => {
    expect(filterLudusDeployTags(["foo", "bar"])).toEqual([])
  })

  it("returns empty for empty input", () => {
    expect(filterLudusDeployTags([])).toEqual([])
  })

  it("handles non-string entries gracefully", () => {
    expect(filterLudusDeployTags([42 as unknown as string, "network"])).toEqual(["network"])
  })

  it("trims whitespace from tag values", () => {
    expect(filterLudusDeployTags([" network "])).toEqual(["network"])
  })

  it("accepts all known tags", () => {
    const result = filterLudusDeployTags([...LUDUS_DEPLOY_TAGS])
    expect(result).toEqual([...LUDUS_DEPLOY_TAGS])
  })
})
