import { describe, expect, it } from "vitest"
import { canonicalRangeYaml } from "@/lib/range/range-builder-document"
import { pickBlueprintCanvasYaml } from "./blueprint-apply"

describe("pickBlueprintCanvasYaml", () => {
  const previous = canonicalRangeYaml("ludus: []\n")
  const range = "ludus:\n  - vm_name: from-range\n"
  const blueprint = "ludus:\n  - vm_name: from-blueprint\n"

  it("draws the range file when apply changed it", () => {
    const picked = pickBlueprintCanvasYaml(previous, range, blueprint)
    expect(picked.source).toBe("range")
    expect(picked.canonical).toBe(canonicalRangeYaml(range))
  })

  it("draws the blueprint when the range file is still the previous one", () => {
    const picked = pickBlueprintCanvasYaml(previous, "ludus: []\n", blueprint)
    expect(picked.source).toBe("blueprint")
    expect(picked.canonical).toBe(canonicalRangeYaml(blueprint))
  })

  it("leaves the picture alone when both copies match the current file", () => {
    const picked = pickBlueprintCanvasYaml(previous, "ludus: []\n", "ludus: []\n")
    expect(picked.source).toBe("unchanged")
    expect(picked.canonical).toBe(previous)
  })
})
