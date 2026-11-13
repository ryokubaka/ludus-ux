import { describe, expect, it } from "vitest"
import {
  arrowHeadPath,
  gapEdgePath,
  intoFace,
  laneKey,
  linkHandles,
  labelThatFits,
  trustAcronym,
  trustLabel,
  trustLinks,
  type DiagramBox,
} from "./builder-routing"

const left: DiagramBox = { x: 40, y: 140, width: 268, height: 420 }
const right: DiagramBox = { x: 396, y: 140, width: 268, height: 220 }
const lower: DiagramBox = { x: 52, y: 360, width: 244, height: 120 }

describe("link handles", () => {
  it("uses the gap between boxes that sit side by side", () => {
    expect(linkHandles(left, right)).toEqual({ sourceHandle: "out", targetHandle: "in", channel: "gap" })
    expect(linkHandles(right, left)).toEqual({
      sourceHandle: "out-left",
      targetHandle: "in-right",
      channel: "gap",
    })
  })

  it("uses the gap when side-by-side boxes are close", () => {
    const near = { ...right, x: left.x + left.width + 8 }
    expect(linkHandles(left, near).channel).toBe("gap")
    expect(linkHandles(left, near).sourceHandle).toBe("out")
    expect(linkHandles(left, near).targetHandle).toBe("in")
  })

  it("routes stacked boxes out the left side when one box sits inside the other", () => {
    expect(linkHandles(left, lower).channel).toBe("side")
    expect(linkHandles(left, lower).sourceHandle).toBe("out-left")
    expect(linkHandles(left, lower).targetHandle).toBe("in")
  })

  it("uses the top and bottom when one box is above the other", () => {
    const upper = { x: 308, y: 64, width: 244, height: 204 }
    const below = { x: 52, y: 280, width: 244, height: 204 }
    expect(linkHandles(upper, below)).toEqual({
      sourceHandle: "out-bottom",
      targetHandle: "in-top",
      channel: "vertical",
    })
    expect(linkHandles(below, upper)).toEqual({
      sourceHandle: "out-top",
      targetHandle: "in-bottom",
      channel: "vertical",
    })
  })

  it("lands a rule from an endpoint above a subnet on the subnet top", () => {
    const wireguard = { x: 411, y: 10, width: 120, height: 28 }
    const subnet = { x: 40, y: 140, width: 524, height: 700 }
    expect(linkHandles(wireguard, subnet)).toEqual({
      sourceHandle: "out-bottom",
      targetHandle: "in-top",
      channel: "vertical",
    })
  })

  it("gives stacked trusts one shared lane sequence", () => {
    expect(laneKey("side", left, lower)).toBe(laneKey("side", lower, left))
  })
})

describe("gap edge path", () => {
  it("draws a facing pair as one curve", () => {
    const path = gapEdgePath({
      sourceX: 308,
      sourceY: 168,
      targetX: 396,
      targetY: 168,
      sourcePosition: "right",
      targetPosition: "left",
      lane: 0,
    })
    expect(path.path).toMatch(/^M 308 168 C /)
    expect(path.path.endsWith("396 168")).toBe(true)
    expect(path.path).not.toContain(" L ")
  })

  it("bows the next lane so it does not retrace the first", () => {
    const first = gapEdgePath({
      sourceX: 308,
      sourceY: 168,
      targetX: 396,
      targetY: 168,
      sourcePosition: "right",
      targetPosition: "left",
      lane: 0,
    })
    const second = gapEdgePath({
      sourceX: 308,
      sourceY: 168,
      targetX: 396,
      targetY: 168,
      sourcePosition: "right",
      targetPosition: "left",
      lane: 1,
    })
    expect(second.path).not.toBe(first.path)
    expect(second.path).toContain("188")
  })

  it("keeps a vertical line in the band between the faces", () => {
    const path = gapEdgePath({
      sourceX: 430,
      sourceY: 38,
      targetX: 302,
      targetY: 140,
      sourcePosition: "bottom",
      targetPosition: "top",
      lane: 0,
    })
    expect(path.path).toContain("430 89")
    expect(path.path.endsWith("L 302 140")).toBe(true)
    expect(path.labelY).toBe(89)
    expect(path.labelY).toBeLessThanOrEqual(140)
  })

  it("walks around a box that sits between the top and bottom faces", () => {
    const path = gapEdgePath({
      sourceX: 174,
      sourceY: 480,
      targetX: 174,
      targetY: 268,
      sourcePosition: "top",
      targetPosition: "bottom",
      lane: 0,
      obstacles: [{ x: 52, y: 280, width: 244, height: 188 }],
    })
    expect(path.path).toContain("320")
    expect(path.path).not.toContain("174 374")
    expect(path.path.startsWith("M 174 480 L 174 475")).toBe(true)
    expect(path.path.endsWith("L 174 268")).toBe(true)
    expect(path.labelPlacement).toBe("after")
  })

  it("stays inside a subnet instead of walking around the subnet border", () => {
    const path = gapEdgePath({
      sourceX: 174,
      sourceY: 480,
      targetX: 174,
      targetY: 268,
      sourcePosition: "top",
      targetPosition: "bottom",
      lane: 0,
      obstacles: [
        { x: 40, y: 140, width: 524, height: 700 },
        { x: 52, y: 280, width: 244, height: 188 },
      ],
    })
    expect(path.path).toContain("320")
    expect(path.path).not.toContain("588")
  })

  it("keeps a stacked trust outside the left edge of the boxes", () => {
    const path = gapEdgePath({
      sourceX: 52,
      sourceY: 180,
      targetX: 52,
      targetY: 400,
      sourcePosition: "left",
      targetPosition: "left",
      lane: 0,
    })
    expect(path.path).toContain("Q 16 180")
    expect(path.labelPlacement).toBe("before")
    expect(path.labelX).toBeLessThan(52)
  })
})

describe("arrow heads", () => {
  it("points into the face the handle sits on", () => {
    expect(intoFace("right")).toEqual({ dx: -1, dy: 0 })
    expect(intoFace("left")).toEqual({ dx: 1, dy: 0 })
    expect(intoFace("top")).toEqual({ dx: 0, dy: 1 })
    expect(intoFace("bottom")).toEqual({ dx: 0, dy: -1 })
  })

  it("keeps the tip on the handle and the base on the stroke", () => {
    expect(arrowHeadPath(174, 268, 0, 1)).toBe("M 174 268 L 170 259 L 178 259 Z")
    expect(arrowHeadPath(40, 80, -1, 0)).toBe("M 40 80 L 49 76 L 49 84 Z")
  })
})

describe("trust links", () => {
  const domains = [
    { fqdn: "essos.local", childOfFqdn: null },
    { fqdn: "north.sevenkingdoms.local", childOfFqdn: "sevenkingdoms.local" },
    { fqdn: "sevenkingdoms.local", childOfFqdn: null },
  ]

  it("collapses a reciprocal lab trust and adds the parent-child line", () => {
    const links = trustLinks(
      [
        { sourceVmId: "goad:essos.local>sevenkingdoms.local", fromFqdn: "essos.local", toFqdn: "sevenkingdoms.local", sidHistory: false },
        { sourceVmId: "goad:sevenkingdoms.local>essos.local", fromFqdn: "sevenkingdoms.local", toFqdn: "essos.local", sidHistory: false },
      ],
      domains,
    )
    expect(links.filter((link) => link.relation === "forest")).toEqual([
      {
        sourceVmId: "goad:essos.local>sevenkingdoms.local",
        fromFqdn: "essos.local",
        toFqdn: "sevenkingdoms.local",
        relation: "forest",
        direction: "two-way",
        sidHistory: false,
      },
    ])
    expect(links.find((link) => link.relation === "parent-child")).toMatchObject({
      fromFqdn: "north.sevenkingdoms.local",
      toFqdn: "sevenkingdoms.local",
      direction: "two-way",
    })
    expect(trustLabel(links[0]!)).toBe("Forest trust · two-way")
    expect(trustLabel(links[1]!)).toBe("Parent-child · two-way")
  })

  it("keeps a one-way lab trust and treats a Ludus trust role as two-way", () => {
    const links = trustLinks(
      [
        { sourceVmId: "goad:a.local>b.local", fromFqdn: "a.local", toFqdn: "b.local", sidHistory: false },
        { sourceVmId: "dc01", fromFqdn: "a.local", toFqdn: "b.local", sidHistory: true },
      ],
      [],
    )
    expect(links.map((link) => link.direction)).toEqual(["one-way", "two-way"])
    expect(trustLabel(links[1]!)).toBe("Forest trust · two-way · SID history")
    expect(trustAcronym(links[1]!)).toBe("FT+SID")
  })

  it("keeps the full relationship name when the gap can hold it", () => {
    expect(labelThatFits("Parent-child · two-way", "PC", 200)).toBe("Parent-child · two-way")
    expect(labelThatFits("Parent-child · two-way", "PC", 40)).toBe("PC")
    expect(trustAcronym({ relation: "parent-child", direction: "two-way", sidHistory: false })).toBe("PC")
  })
})
