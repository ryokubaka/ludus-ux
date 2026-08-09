import { describe, expect, it } from "vitest"
import {
  DEFAULT_SOURCE_GIT_REF,
  ludusSourceGitRef,
  normalizeLudusSourceRef,
} from "@/lib/ludus-source-ref"

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
