/** Where a dragged machine or domain lands. Geometry only — the canvas applies the document edit. */

export interface DropRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type HostDrop =
  | { kind: "stay" }
  | { kind: "snap" }
  | { kind: "join-domain"; fqdn: string; vlan: number | null }
  | { kind: "place-vlan"; vlan: number; unjoin: boolean }
  | { kind: "move-domain"; toVlan: number }

interface DomainTarget extends DropRect {
  fqdn: string
  vlan: number | null
}

interface VlanTarget extends DropRect {
  vlan: number
}

function contains(rect: DropRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

function overlapRatio(node: DropRect, target: DropRect): number {
  const area = node.width * node.height
  if (area <= 0) return 0
  const width = Math.max(
    0,
    Math.min(node.x + node.width, target.x + target.width) - Math.max(node.x, target.x),
  )
  const height = Math.max(
    0,
    Math.min(node.y + node.height, target.y + target.height) - Math.max(node.y, target.y),
  )
  return (width * height) / area
}

function bestOverlap<T extends DropRect>(node: DropRect, targets: readonly T[], minimum: number): T | null {
  let best: T | null = null
  let score = minimum
  for (const target of targets) {
    const ratio = overlapRatio(node, target)
    if (ratio > score) {
      best = target
      score = ratio
    }
  }
  return best
}

/** `domain:lab.local@10` → 10. A floating domain id has no VLAN. */
export function domainVlanFromNodeId(id: string): number | null {
  if (!id.startsWith("domain:")) return null
  const at = id.lastIndexOf("@")
  if (at < 0) return null
  const vlan = Number(id.slice(at + 1))
  return Number.isInteger(vlan) && vlan >= 0 ? vlan : null
}

/**
 * A machine joins the domain under its center (or the domain it mostly covers).
 * Otherwise it takes the subnet under it, and leaves a domain when its center
 * is in that subnet's unjoined area. A domain box moves when another subnet
 * covers more of it than the subnet it came from.
 */
export function hostDropTarget(args: {
  moving: "vm" | "domain"
  rect: DropRect
  parentId: string | null
  currentVlan: number | null
  domains: readonly DomainTarget[]
  vlans: readonly VlanTarget[]
}): HostDrop {
  const center = { x: args.rect.x + args.rect.width / 2, y: args.rect.y + args.rect.height / 2 }
  if (args.moving === "domain") return domainDrop(args)
  return vmDrop(args, center)
}

function domainDrop(args: {
  rect: DropRect
  parentId: string | null
  vlans: readonly VlanTarget[]
}): HostDrop {
  const parent = args.vlans.find((vlan) => vlan.id === args.parentId) ?? null
  const parentRatio = parent ? overlapRatio(args.rect, parent) : 0
  let best: VlanTarget | null = null
  let bestRatio = 0
  for (const vlan of args.vlans) {
    if (vlan.id === args.parentId) continue
    const ratio = overlapRatio(args.rect, vlan)
    if (ratio > bestRatio) {
      best = vlan
      bestRatio = ratio
    }
  }
  if (best && bestRatio >= 0.35 && (parent == null || bestRatio > parentRatio)) {
    return { kind: "move-domain", toVlan: best.vlan }
  }
  if (args.parentId && parentRatio < 0.2) return { kind: "snap" }
  return { kind: "stay" }
}

function vmDrop(
  args: {
    rect: DropRect
    parentId: string | null
    currentVlan: number | null
    domains: readonly DomainTarget[]
    vlans: readonly VlanTarget[]
  },
  center: { x: number; y: number },
): HostDrop {
  const domain =
    args.domains.find((item) => contains(item, center.x, center.y)) ??
    bestOverlap(args.rect, args.domains, 0.5)
  if (domain && domain.id !== args.parentId) {
    return { kind: "join-domain", fqdn: domain.fqdn, vlan: domain.vlan }
  }
  if (domain && domain.id === args.parentId) return { kind: "stay" }

  const vlan =
    args.vlans.find((item) => contains(item, center.x, center.y)) ??
    bestOverlap(args.rect, args.vlans, 0.5)
  if (!vlan) return args.parentId ? { kind: "snap" } : { kind: "stay" }
  if (vlan.id === args.parentId) return { kind: "stay" }
  const leavingDomain = args.parentId?.startsWith("domain:") === true
  if (!leavingDomain && vlan.vlan === args.currentVlan) return { kind: "stay" }
  return { kind: "place-vlan", vlan: vlan.vlan, unjoin: leavingDomain }
}
