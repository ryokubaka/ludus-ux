/** How a domain relationship is drawn. Parent-child is not a forest trust. */
export type TrustRelation = "forest" | "parent-child"
export type TrustDirection = "two-way" | "one-way"

export interface DiagramBox {
  x: number
  y: number
  width: number
  height: number
}

export interface DrawnTrust {
  sourceVmId: string
  fromFqdn: string
  toFqdn: string
  relation: TrustRelation
  direction: TrustDirection
  sidHistory: boolean
}

interface TrustInput {
  sourceVmId: string
  fromFqdn: string | null
  toFqdn: string
  sidHistory: boolean
}

/**
 * One edge per relationship. A GOAD lab lists a forest trust on both domains;
 * those become one two-way line. The Ludus trust role is two-way on its own.
 * A child domain is a separate two-way parent-child trust.
 */
export function trustLinks(
  trusts: readonly TrustInput[],
  domains: readonly { fqdn: string; childOfFqdn: string | null }[],
): DrawnTrust[] {
  const drawn: DrawnTrust[] = []
  const used = new Set<number>()
  trusts.forEach((trust, index) => {
    if (used.has(index) || !trust.fromFqdn || !trust.toFqdn || trust.fromFqdn === trust.toFqdn) return
    const reverseAt = trusts.findIndex(
      (other, otherIndex) =>
        otherIndex !== index &&
        !used.has(otherIndex) &&
        other.fromFqdn === trust.toFqdn &&
        other.toFqdn === trust.fromFqdn,
    )
    const reverse = reverseAt === -1 ? undefined : trusts[reverseAt]
    if (reverseAt !== -1) used.add(reverseAt)
    const fromLab = trust.sourceVmId.startsWith("goad:")
    drawn.push({
      sourceVmId: trust.sourceVmId,
      fromFqdn: trust.fromFqdn,
      toFqdn: trust.toFqdn,
      relation: "forest",
      direction: !fromLab || reverse != null ? "two-way" : "one-way",
      sidHistory: trust.sidHistory || reverse?.sidHistory === true,
    })
  })

  const known = new Set(domains.map((domain) => domain.fqdn))
  for (const domain of domains) {
    const parent = domain.childOfFqdn
    if (!parent || parent === domain.fqdn || !known.has(parent)) continue
    drawn.push({
      sourceVmId: `child:${domain.fqdn}>${parent}`,
      fromFqdn: domain.fqdn,
      toFqdn: parent,
      relation: "parent-child",
      direction: "two-way",
      sidHistory: false,
    })
  }
  return drawn
}

export function trustLabel(link: Pick<DrawnTrust, "relation" | "direction" | "sidHistory">): string {
  if (link.relation === "parent-child") return "Parent-child · two-way"
  const head = link.direction === "two-way" ? "Forest trust · two-way" : "Forest trust · one-way"
  return link.sidHistory ? `${head} · SID history` : head
}

/** Short form of a relationship when the gap cannot hold the full label. */
export function trustAcronym(link: Pick<DrawnTrust, "relation" | "direction" | "sidHistory">): string {
  if (link.relation === "parent-child") return "PC"
  const head = link.direction === "two-way" ? "FT" : "FT→"
  return link.sidHistory ? `${head}+SID` : head
}

/** Full text when it fits the gap, otherwise the acronym. */
export function labelThatFits(full: string, short: string, roomPx: number): string {
  const text = full.trim()
  const brief = short.trim() || text
  if (!text) return brief
  if (text.length * 6.2 + 12 <= roomPx) return text
  return brief
}

/**
 * Side-by-side boxes meet in the gap between them. A box that sits above another
 * uses the bottom and top faces, so the line stays in the open band instead of
 * crossing a neighbor to reach a side.
 */
export function linkHandles(source: DiagramBox, target: DiagramBox): {
  sourceHandle: "out" | "out-left" | "out-top" | "out-bottom"
  targetHandle: "in" | "in-right" | "in-top" | "in-bottom"
  channel: "gap" | "side" | "vertical"
} {
  const sourceRight = source.x + source.width
  const targetRight = target.x + target.width
  const gapX = Math.max(source.x, target.x) - Math.min(sourceRight, targetRight)
  const sourceBottom = source.y + source.height
  const targetBottom = target.y + target.height
  const gapY = Math.max(source.y, target.y) - Math.min(sourceBottom, targetBottom)
  const sideBySide = gapX > 0 && gapY < 0
  if (gapY > 0 && !sideBySide) {
    const sourceAbove = sourceBottom <= target.y
    return sourceAbove
      ? { sourceHandle: "out-bottom", targetHandle: "in-top", channel: "vertical" }
      : { sourceHandle: "out-top", targetHandle: "in-bottom", channel: "vertical" }
  }
  if (sideBySide || (gapX > 16 && gapX >= gapY)) {
    const sourceOnLeft = source.x + source.width / 2 <= target.x + target.width / 2
    return sourceOnLeft
      ? { sourceHandle: "out", targetHandle: "in", channel: "gap" }
      : { sourceHandle: "out-left", targetHandle: "in-right", channel: "gap" }
  }
  return { sourceHandle: "out-left", targetHandle: "in", channel: "side" }
}

/** Edges that share a corridor take the next lane so their strokes do not sit on each other. */
export function laneKey(channel: "gap" | "side" | "vertical", source: DiagramBox, target: DiagramBox): string {
  if (channel === "side") return `side:${Math.round(Math.min(source.x, target.x) / 48)}`
  if (channel === "vertical") {
    const top = Math.round(Math.min(source.y, target.y) / 48)
    return `vertical:${top}`
  }
  const gapLeft = Math.min(source.x + source.width, target.x + target.width)
  const band = Math.round((source.y + source.height / 2 + target.y + target.height / 2) / 2 / 48)
  return `gap:${Math.round(gapLeft / 48)}:${band}`
}

export interface GapPath {
  path: string
  labelX: number
  labelY: number
  /** `before` keeps a side-channel label off the subnet it runs beside. */
  labelPlacement: "center" | "before" | "after"
}

function horizontalDir(position: string): number {
  if (position === "left") return -1
  if (position === "right") return 1
  return 0
}

function roundedOrthogonal(points: Array<[number, number]>, radius: number): string {
  const first = points[0]
  if (!first) return ""
  let path = `M ${first[0]} ${first[1]}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    if (!prev || !current || !next) continue
    const inDx = current[0] - prev[0]
    const inDy = current[1] - prev[1]
    const outDx = next[0] - current[0]
    const outDy = next[1] - current[1]
    const inLen = Math.hypot(inDx, inDy)
    const outLen = Math.hypot(outDx, outDy)
    const trim = Math.min(radius, inLen / 2, outLen / 2)
    if (trim < 1 || inLen === 0 || outLen === 0) {
      path += ` L ${current[0]} ${current[1]}`
      continue
    }
    const startX = Math.round(current[0] - (inDx / inLen) * trim)
    const startY = Math.round(current[1] - (inDy / inLen) * trim)
    const endX = Math.round(current[0] + (outDx / outLen) * trim)
    const endY = Math.round(current[1] + (outDy / outLen) * trim)
    path += ` L ${startX} ${startY} Q ${current[0]} ${current[1]}, ${endX} ${endY}`
  }
  const last = points[points.length - 1]
  if (last) path += ` L ${last[0]} ${last[1]}`
  return path
}

function cubicPoint(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** Direction an arrowhead points so it enters the box through that face. */
export function intoFace(position: string): { dx: number; dy: number } {
  if (position === "left") return { dx: 1, dy: 0 }
  if (position === "right") return { dx: -1, dy: 0 }
  if (position === "top") return { dx: 0, dy: 1 }
  return { dx: 0, dy: -1 }
}

/** Filled arrow with its tip at the handle. Drawn in the edge, not as an SVG marker. */
export function arrowHeadPath(x: number, y: number, dx: number, dy: number): string {
  const hyp = Math.hypot(dx, dy) || 1
  const ux = dx / hyp
  const uy = dy / hyp
  const length = 9
  const half = 4
  const bx = x - ux * length
  const by = y - uy * length
  const px = -uy * half
  const py = ux * half
  const r = (value: number) => Math.round(value * 10) / 10
  return `M ${r(x)} ${r(y)} L ${r(bx + px)} ${r(by + py)} L ${r(bx - px)} ${r(by - py)} Z`
}

const FACE_STEM = 18

function outward(position: string, x: number, y: number, length: number): [number, number] {
  if (length <= 0) return [x, y]
  if (position === "left") return [x - length, y]
  if (position === "right") return [x + length, y]
  if (position === "top") return [x, y - length]
  return [x, y + length]
}

/** Open pixels from a handle to the next box in the direction the line leaves that face. */
function clearance(position: string, x: number, y: number, obstacles: readonly DiagramBox[]): number {
  let room = Number.POSITIVE_INFINITY
  for (const box of obstacles) {
    const right = box.x + box.width
    const bottom = box.y + box.height
    if (position === "top" || position === "bottom") {
      if (x <= box.x || x >= right) continue
      if (position === "top" && bottom <= y) room = Math.min(room, y - bottom)
      if (position === "bottom" && box.y >= y) room = Math.min(room, box.y - y)
    } else if (y > box.y && y < bottom) {
      if (position === "left" && right <= x) room = Math.min(room, x - right)
      if (position === "right" && box.x >= x) room = Math.min(room, box.x - x)
    }
  }
  return room
}

function stemLength(room: number, limit: number): number {
  const want = Math.min(FACE_STEM, Math.max(0, limit))
  if (!Number.isFinite(room)) return want
  const fit = Math.floor(room) - 2
  if (fit >= want) return want
  return Math.max(0, fit)
}

/**
 * One curve between facing handles, bowed per lane so neighbors stay apart.
 * Stacked boxes keep a rounded channel outside the subnet instead of a hard step.
 */
export function gapEdgePath(args: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
  lane: number
  obstacles?: readonly DiagramBox[]
}): GapPath {
  const verticalEnds =
    (args.sourcePosition === "top" || args.sourcePosition === "bottom") &&
    (args.targetPosition === "top" || args.targetPosition === "bottom")
  if (verticalEnds) {
    const above = Math.min(args.sourceY, args.targetY)
    const below = Math.max(args.sourceY, args.targetY)
    const obstacles = (args.obstacles ?? []).filter((box) => {
      const left = Math.min(args.sourceX, args.targetX)
      const right = Math.max(args.sourceX, args.targetX)
      const encloses = box.x <= left && box.x + box.width >= right && box.y <= above && box.y + box.height >= below
      return !encloses
    })
    const blocked = obstacles.filter((box) => {
      const spanTop = above + 6
      const spanBottom = below - 6
      if (spanBottom - spanTop < 8) return false
      const left = Math.min(args.sourceX, args.targetX) - 4
      const right = Math.max(args.sourceX, args.targetX) + 4
      return box.y < spanBottom && box.y + box.height > spanTop && box.x < right && box.x + box.width > left
    })
    if (blocked.length > 0) {
      const pad = 24 + args.lane * 14
      const rightX = Math.max(...blocked.map((box) => box.x + box.width)) + pad
      const leftX = Math.min(...blocked.map((box) => box.x)) - pad
      const clear = (x: number) =>
        !obstacles.some(
          (box) => box.x < x && box.x + box.width > x && box.y < below - 6 && box.y + box.height > above + 6,
        )
      const laneX = clear(rightX) ? rightX : leftX
      const beside = laneX >= Math.max(args.sourceX, args.targetX) ? "after" : "before"
      const span = Math.abs(args.targetY - args.sourceY)
      const half = Math.max(0, (span - 12) / 2)
      const sourceLen = stemLength(clearance(args.sourcePosition, args.sourceX, args.sourceY, obstacles), half)
      const targetLen = stemLength(clearance(args.targetPosition, args.targetX, args.targetY, obstacles), half)
      const sourceExit = outward(args.sourcePosition, args.sourceX, args.sourceY, sourceLen)
      const targetExit = outward(args.targetPosition, args.targetX, args.targetY, targetLen)
      const points: Array<[number, number]> = [[args.sourceX, args.sourceY]]
      if (sourceLen > 0) points.push(sourceExit)
      points.push([laneX, sourceExit[1]], [laneX, targetExit[1]])
      if (targetLen > 0) points.push(targetExit)
      points.push([args.targetX, args.targetY])
      return {
        path: roundedOrthogonal(points, 8),
        labelX: laneX,
        labelY: (args.sourceY + args.targetY) / 2,
        labelPlacement: beside,
      }
    }
    const laneY = Math.round((above + below) / 2 + args.lane * 14)
    const span = Math.abs(args.targetX - args.sourceX)
    return {
      path: roundedOrthogonal(
        [
          [args.sourceX, args.sourceY],
          [args.sourceX, laneY],
          [args.targetX, laneY],
          [args.targetX, args.targetY],
        ],
        8,
      ),
      labelX: span < 48 ? Math.min(args.sourceX, args.targetX) : (args.sourceX + args.targetX) / 2,
      labelY: laneY,
      labelPlacement: span < 48 ? "before" : "center",
    }
  }
  const sameHorizontalSide =
    args.sourcePosition === args.targetPosition &&
    (args.sourcePosition === "left" || args.sourcePosition === "right")
  if (sameHorizontalSide) {
    const dir = args.sourcePosition === "left" ? -1 : 1
    const x =
      (dir < 0 ? Math.min(args.sourceX, args.targetX) : Math.max(args.sourceX, args.targetX)) +
      dir * (36 + args.lane * 18)
    return {
      path: roundedOrthogonal(
        [
          [args.sourceX, args.sourceY],
          [x, args.sourceY],
          [x, args.targetY],
          [args.targetX, args.targetY],
        ],
        14,
      ),
      labelX: x,
      labelY: (args.sourceY + args.targetY) / 2,
      labelPlacement: dir < 0 ? "before" : "after",
    }
  }
  const gap = Math.abs(args.targetX - args.sourceX)
  const pull = gap < 8 ? gap / 2 : Math.min(Math.max(gap * 0.42, 28), gap * 0.48)
  const sourceDir = horizontalDir(args.sourcePosition) || (args.targetX >= args.sourceX ? 1 : -1)
  const targetDir = horizontalDir(args.targetPosition) || (args.sourceX >= args.targetX ? 1 : -1)
  const bow = args.lane * 20
  const c1x = args.sourceX + sourceDir * pull
  const c1y = args.sourceY + bow
  const c2x = args.targetX + targetDir * pull
  const c2y = args.targetY + bow
  return {
    path: `M ${args.sourceX} ${args.sourceY} C ${Math.round(c1x)} ${Math.round(c1y)}, ${Math.round(c2x)} ${Math.round(c2y)}, ${args.targetX} ${args.targetY}`,
    labelX: cubicPoint(0.5, args.sourceX, c1x, c2x, args.targetX),
    labelY: cubicPoint(0.5, args.sourceY, c1y, c2y, args.targetY),
    labelPlacement: "center",
  }
}
