import { describe, expect, it } from "vitest"
import {
  DEFAULT_SOURCE_GIT_REF,
  ludusSourceGitRef,
  normalizeGitSourceUrl,
  normalizeLudusSourceRef,
  suggestedLudusSourceId,
} from "@/lib/ludus-source-ref"

describe("suggestedLudusSourceId", () => {
  it("keeps repo-only id for main/master", () => {
    expect(suggestedLudusSourceId("https://github.com/ryokubaka/ludus-source-meow", "main")).toBe(
      "ryokubaka-ludus-source-meow",
    )
    expect(suggestedLudusSourceId("https://github.com/ryokubaka/ludus-source-meow.git", "master")).toBe(
      "ryokubaka-ludus-source-meow",
    )
  })

  it("appends non-default ref so same-repo branches stay distinct", () => {
    expect(suggestedLudusSourceId("https://github.com/ryokubaka/ludus-source-meow", "elastic")).toBe(
      "ryokubaka-ludus-source-meow-elastic",
    )
    expect(suggestedLudusSourceId("https://github.com/ryokubaka/ludus-source-meow", "feature/so")).toBe(
      "ryokubaka-ludus-source-meow-feature-so",
    )
  })
})

describe("normalizeGitSourceUrl", () => {
  it("strips .git and trailing slash", () => {
    expect(normalizeGitSourceUrl("https://GitHub.com/Org/Repo.git/")).toBe(
      "https://github.com/org/repo",
    )
  })
})

describe("ludusSourceGitRef", () => {
  it("prefers configured ref over default main", () => {
    expect(ludusSourceGitRef({ ref: "develop" })).toBe("develop")
    expect(ludusSourceGitRef({ Ref: "v1.2.3" })).toBe("v1.2.3")
    expect(ludusSourceGitRef({ branch: "feature/so" })).toBe("feature/so")
    expect(ludusSourceGitRef({ git_ref: "abc1234" })).toBe("abc1234")
  })

  it("does not substitute main when ref is set", () => {
    expect(ludusSourceGitRef({ ref: "release/1.x", Branch: "main" })).toBe("release/1.x")
  })

  it("falls back only when unset", () => {
    expect(ludusSourceGitRef({})).toBe(DEFAULT_SOURCE_GIT_REF)
    expect(ludusSourceGitRef(null, "custom")).toBe("custom")
  })

  it("normalizeLudusSourceRef writes canonical ref", () => {
    expect(normalizeLudusSourceRef({ sourceID: "x", Branch: "dev" }).ref).toBe("dev")
  })
})
