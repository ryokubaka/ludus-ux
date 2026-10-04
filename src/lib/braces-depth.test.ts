import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, it } from "vitest"

const require = createRequire(path.resolve("node_modules/micromatch/index.js"))
const braces = require("braces") as (pattern: string, options?: { expand?: boolean }) => string[]

describe("patched braces", () => {
  it("expands a normal pattern", () => {
    expect(braces("{a,b}", { expand: true })).toEqual(["a", "b"])
  })

  it("rejects nesting deep enough to overflow the stack", () => {
    const nested = "{".repeat(4000) + "a" + "}".repeat(4000)
    expect(() => braces(nested, { expand: true })).toThrow(RangeError)
    expect(() => braces(nested)).toThrow(RangeError)
  })
})
