import { describe, expect, it } from "vitest"
import { sanitizeRangeBuilderLayout } from "@/lib/range/range-builder-layout-store"

describe("sanitizeRangeBuilderLayout", () => {
  it("keeps a normal node and drops a non-position", () => {
    const layout = sanitizeRangeBuilderLayout({
      "vlan:10": { x: 12, y: 40, width: 0, height: 80 },
      "domain:essos.local@10": { x: 1, y: 2 },
      router: { x: "nope", y: 1 },
    })
    expect(layout["vlan:10"]).toEqual({ x: 12, y: 40, height: 80 })
    expect(layout["domain:essos.local@10"]).toEqual({ x: 1, y: 2 })
    expect(layout.router).toBeUndefined()
  })

  it("does not let a node id replace the object prototype", () => {
    const layout = sanitizeRangeBuilderLayout(
      JSON.parse(
        '{"__proto__":{"x":1,"y":2},"constructor":{"x":3,"y":4},"prototype":{"x":5,"y":6},"router":{"x":8,"y":9}}',
      ),
    )
    expect(layout.router).toEqual({ x: 8, y: 9 })
    expect(Object.prototype.hasOwnProperty.call(layout, "__proto__")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(layout, "constructor")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(layout, "prototype")).toBe(false)
    expect(Object.getPrototypeOf(layout)).toBe(Object.prototype)
  })
})
