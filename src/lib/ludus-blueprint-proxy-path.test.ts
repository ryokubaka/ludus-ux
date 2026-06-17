import { describe, expect, it } from "vitest"
import { ludusBlueprintApiPath, normalizeLudusProxyPath } from "./ludus-blueprint-proxy-path"

describe("ludus-blueprint-proxy-path", () => {
  it("encodes source blueprint ids as a single Ludus path parameter", () => {
    expect(ludusBlueprintApiPath("ludus-source-bsl/ad-elastic-range")).toBe(
      "/blueprints/ludus-source-bsl%2Fad-elastic-range",
    )
    expect(ludusBlueprintApiPath("ludus-source-bsl/ad-elastic-range", "config")).toBe(
      "/blueprints/ludus-source-bsl%2Fad-elastic-range/config",
    )
  })

  it("rewrites proxy catch-all segments for source blueprint delete", () => {
    expect(
      normalizeLudusProxyPath(["blueprints", "ludus-source-bsl", "ad-elastic-range"]),
    ).toBe("/blueprints/ludus-source-bsl%2Fad-elastic-range")
  })

  it("rewrites proxy catch-all segments for blueprint config", () => {
    expect(
      normalizeLudusProxyPath(["blueprints", "ludus-source-bsl", "ad-elastic-range", "config"]),
    ).toBe("/blueprints/ludus-source-bsl%2Fad-elastic-range/config")
  })

  it("does not double-encode ids when proxy segment already contains %2F", () => {
    expect(normalizeLudusProxyPath(["blueprints", "ludus-source-bsl%2Fgoad"])).toBe(
      "/blueprints/ludus-source-bsl%2Fgoad",
    )
  })

  it("normalizes partially encoded blueprint ids", () => {
    expect(ludusBlueprintApiPath("ludus-source-bsl%2Fgoad")).toBe(
      "/blueprints/ludus-source-bsl%2Fgoad",
    )
  })
})
