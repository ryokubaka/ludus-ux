import { describe, expect, it } from "vitest"
import { isSourcesApiUnavailableError } from "@/lib/ludus-source-client"

describe("isSourcesApiUnavailableError", () => {
  it("detects missing /sources on pre-2.2.0 Ludus", () => {
    expect(isSourcesApiUnavailableError(new Error("Failed to list sources (HTTP 404)"))).toBe(true)
  })

  it("does not treat install 404 as missing API", () => {
    expect(isSourcesApiUnavailableError(new Error("Source install failed (HTTP 404)"))).toBe(false)
    expect(
      isSourcesApiUnavailableError(new Error("collection ludus_windows_utils not found")),
    ).toBe(false)
  })

  it("does not treat sync 404 as missing API", () => {
    expect(isSourcesApiUnavailableError(new Error("Source sync failed (HTTP 404)"))).toBe(false)
  })
})
