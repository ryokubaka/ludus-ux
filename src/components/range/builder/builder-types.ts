import type { Node, Edge } from "@xyflow/react"
import type { RangeBuilderLayout } from "@/lib/range/range-builder-layout-store"
import type {
  BuilderVm,
  BuilderVlan,
  BuilderDomain,
  BuilderRouter,
  BuilderGraph,
} from "@/lib/range/range-builder-document"

/** Payload carried by a palette drag via dataTransfer. */
export type PaletteDragPayload =
  | { kind: "template"; template: string }
  | { kind: "network" }
  | { kind: "domain" }
  | { kind: "extension"; name: string }

export const PALETTE_DND_MIME = "application/lux-range-builder"

/** Ludus groups by VLAN. GOAD groups by domain, the way a lab is drawn. */
export type BuilderKind = "ludus" | "goad"
/** Composer until the first deploy. After that the left rail is the live range. */
export type BuilderSurface = "composer" | "viewer"

export interface BlueprintPaletteItem {
  id: string
  name: string
  description?: string
  /** Group header. Loaded Ludus source label, or "On this host" for a blueprint that is not from a source. */
  sourceLabel?: string
  sourceId?: string
  /** Short name passed to the source install API. */
  installName?: string
  /** Set when this source blueprint is already installed, so loading it skips install. */
  installedId?: string
}

export interface LiveVmRow {
  name: string
  poweredOn: boolean
  ip: string
}

export type VmNodeData = {
  kind: "vm"
  vm: BuilderVm
  hasError: boolean
  locked: boolean
  /** Ludus address `10.{rangeNumber}.{vlan}.{octet}`, or `v{vlan}.{octet}` before a range number exists. */
  address: string
  /** `testing.block_internet: false` — this VM keeps internet while the range is in testing mode. */
  keepsInternet: boolean
  /** Viewer only. Null hides the mark (composer, or status not loaded). */
  presence: "on" | "off" | "missing" | null
  /** Validation errors for this host. */
  messages?: string[]
  /** Set when a resized parent is wider or taller than the default card. */
  cardWidth?: number
  cardHeight?: number
  /** Extension VM drawn before deploy. */
  pending?: boolean
}
export type VlanNodeData = {
  kind: "vlan"
  vlan: number
  count: number
  /** `10.{rangeNumber}.{vlan}.0/24` once the range number is known. */
  subnet: string | null
  /** Index into the subnet color list so adjacent VLANs are easy to tell apart. */
  tone: number
  /** More than one domain uses this VLAN, so the box stays even though machines sit in domain boxes. */
  shared: boolean
  /** Y of the first host that is on this subnet and not in a domain box. */
  unjoinedAt: number | null
  /** X of the "Not joined" caption. The host may sit in a later column. */
  unjoinedLabelX?: number
  boxHeight: number
}
export type DomainNodeData = {
  kind: "domain"
  domain: BuilderDomain
  locked: boolean
  hasError: boolean
  /** Members of this domain on one subnet are drawn inside the subnet box. */
  grouped: boolean
  count: number
  subnet: string | null
  /** Validation errors for this domain. */
  messages?: string[]
}
export type RouterNodeData = { kind: "router"; router: BuilderRouter }
export type InternetState = "on" | "testing" | "firewall"
export type EndpointNodeData = {
  kind: "endpoint"
  endpoint: "wireguard" | "public"
  /** Set on the public endpoint. Testing mode and a rejecting external default both block internet. */
  internet?: InternetState
}

export type BuilderNodeData =
  | VmNodeData
  | VlanNodeData
  | DomainNodeData
  | RouterNodeData
  | EndpointNodeData

export type BuilderNode = Node<BuilderNodeData>

export type BuilderEdgeData = {
  kind: "firewall" | "membership" | "trust" | "depends" | "gateway"
  /** Rule index in evaluation order (firewall edges only). */
  ruleIndex?: number
  /** Reverse rule drawn on the same line, when one exists. */
  mirrorIndex?: number
  /** Source VM id for a trust edge, or `child:` / `goad:` for a derived trust. */
  trustSourceVmId?: string
  relation?: "forest" | "parent-child"
  /** Lane in a shared corridor. Zero is the direct path. */
  lane?: number
  /** Shown when the full label does not fit in the gap. */
  shortLabel?: string
  /** Other boxes the stroke should stay out of. */
  obstacles?: Array<{ x: number; y: number; width: number; height: number }>
  /** depends_on specifics. */
  depends?: { fromVmId: string; fromRole: string; toVmName: string; toRole: string }
}

export type BuilderEdge = Edge<BuilderEdgeData>

export type DependsSelectionEdge = NonNullable<BuilderEdgeData["depends"]>

export type BuilderSelection =
  | { kind: "none" }
  | { kind: "vm"; vmId: string }
  | { kind: "vlan"; vlan: number }
  | { kind: "domain"; fqdn: string }
  | { kind: "router" }
  | { kind: "rule"; ruleIndex: number; mirrorIndex?: number }
  | { kind: "trust"; sourceVmId: string }
  | { kind: "depends"; edge: DependsSelectionEdge }

export function vlanNodeId(vlan: number): string {
  return `vlan:${vlan}`
}
export function domainNodeId(fqdn: string, vlan?: number): string {
  return vlan == null ? `domain:${fqdn}` : `domain:${fqdn}@${vlan}`
}
export function domainFqdnFromNodeId(id: string): string {
  const rest = id.startsWith("domain:") ? id.slice("domain:".length) : id
  const at = rest.lastIndexOf("@")
  return at === -1 ? rest : rest.slice(0, at)
}
export const ROUTER_NODE_ID = "router"
export function endpointNodeId(endpoint: "wireguard" | "public"): string {
  return `endpoint:${endpoint}`
}

/** Resolved Ludus router, plus the live Proxmox VM when the range has been deployed. */
export interface RouterDetails {
  template: string
  built: boolean
  vmName: string
  hostname: string | null
  ramGb: number | null
  cpus: number | null
  live: {
    name: string
    ip: string
    poweredOn: boolean
    proxmoxId: number
  } | null
  gateways: Array<{ vlan: number; address: string | null }>
}

export interface TemplateRow {
  name: string
  built: boolean
  os: "windows" | "linux" | "macos" | "other"
}

const TEMPLATE_OS_ORDER = ["windows", "linux", "macos", "other"] as const

const TEMPLATE_OS_LABEL: Record<TemplateRow["os"], string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  other: "Other",
}

/** Palette groups. Windows, then Linux, then anything else. Built templates come first inside a group. */
export function groupTemplates(
  templates: readonly TemplateRow[],
): Array<{ os: TemplateRow["os"]; label: string; rows: TemplateRow[] }> {
  const buckets = new Map<TemplateRow["os"], TemplateRow[]>(TEMPLATE_OS_ORDER.map((os) => [os, []]))
  for (const template of templates) {
    const list = buckets.get(template.os) ?? buckets.get("other")
    list?.push(template)
  }
  return TEMPLATE_OS_ORDER.flatMap((os) => {
    const rows = buckets.get(os) ?? []
    if (rows.length === 0) return []
    rows.sort((a, b) => Number(b.built) - Number(a.built) || a.name.localeCompare(b.name))
    return [{ os, label: TEMPLATE_OS_LABEL[os], rows }]
  })
}

/** Drop saved box sizes and use the packed positions. Absent keys keep their current x,y. */
export function compactLayout(
  current: RangeBuilderLayout,
  positions: RangeBuilderLayout,
): RangeBuilderLayout {
  const ids = new Set([...Object.keys(current), ...Object.keys(positions)])
  const next: RangeBuilderLayout = {}
  for (const id of ids) {
    const pos = positions[id] ?? current[id]
    if (!pos) continue
    next[id] = { x: pos.x, y: pos.y }
  }
  return next
}

/** GOAD state passed to the builder when the open range maps to a GOAD instance. */
export interface GoadBuilderContext {
  instanceId: string
  labName: string | null
  /** Extensions compatible with this lab (stock + custom folders on the GOAD host). */
  extensions: import("@/lib/core/types").GoadExtensionDef[]
  installed: Set<string>
  /** Placed on the canvas, waiting for deploy. */
  pending: Set<string>
  isRunning: boolean
  extensionReady: (ext: import("@/lib/core/types").GoadExtensionDef) => {
    ready: boolean
    missingTemplates: string[]
    missingAnsible: string[]
  }
  onInstall: (name: string) => void
  onUnstage: (name: string) => void
  onRemove: (name: string) => void
  onInstallDeps: (ext: import("@/lib/core/types").GoadExtensionDef) => void
}

/** VLAN group box. VMs are children, so their positions are relative to this box. */
export const VLAN_GROUP_WIDTH = 268
/** Two lines: name and badge, then the CIDR. */
export const VLAN_HEADER = 52
const VLAN_PAD = 12
const VLAN_VM_STRIDE = 68

export function vlanGroupHeight(vmCount: number): number {
  const rows = Math.max(vmCount, 1)
  return VLAN_HEADER + VLAN_PAD + rows * VLAN_VM_STRIDE + VLAN_PAD
}

/** Default slot for the nth VM inside its VLAN group, ordered by last octet. */
export function defaultVmPosition(row: number): { x: number; y: number } {
  return { x: VLAN_PAD, y: VLAN_HEADER + VLAN_PAD + row * VLAN_VM_STRIDE }
}

export function vmsInVlan(graph: BuilderGraph, vlan: BuilderVlan): BuilderVm[] {
  const ids = new Set(vlan.vmIds)
  return graph.vms
    .filter((vm) => ids.has(vm.id))
    .sort((a, b) => a.ipLastOctet - b.ipLastOctet || a.id.localeCompare(b.id))
}

const DOMAIN_HEADER = 44
const DOMAIN_PAD = 12
const STACK_GAP = 8
/** Space between boxes that have no line between them. */
const PACK_GAP = 12
/** Corridor for one relationship line and its label. Not applied to the rest of the row. */
const LINK_GAP = 88
/** Parent above child. Room for the arrowheads and the short label between the faces. */
const VERTICAL_LINK_GAP = 64
/** Forest trust beside its domain. Wide enough for the full trust label. */
const TRUST_GAP = 168
const UNJOINED_CAPTION = 22
/** "Not joined" at 9px uppercase. Kept inside the subnet, above those machines. */
const UNJOINED_CAPTION_WIDTH = 76

export function domainPairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`
}

/** Domain box inset inside a subnet. Wide enough for a VM card plus padding. */
export const DOMAIN_BOX_WIDTH = VLAN_GROUP_WIDTH - VLAN_PAD * 2

export function domainGroupHeight(memberCount: number): number {
  const rows = Math.max(memberCount, 1)
  return DOMAIN_HEADER + DOMAIN_PAD + rows * VLAN_VM_STRIDE + DOMAIN_PAD
}

/** Slot for the nth member inside its domain box. */
export function vmPositionInDomain(row: number): { x: number; y: number } {
  return { x: DOMAIN_PAD, y: DOMAIN_HEADER + DOMAIN_PAD + row * VLAN_VM_STRIDE }
}

export interface StackCard {
  id: string
  x: number
  y: number
  width: number
  height?: number
}

export interface VlanStack {
  domains: Array<{
    fqdn: string
    memberIds: string[]
    x: number
    y: number
    width: number
    height: number
    members: StackCard[]
  }>
  unjoined: StackCard[]
  unjoinedAt: number | null
  unjoinedLabelX: number
  height: number
  width: number
  /** Height before a resize stretches the subnet. The resizer will not go below this. */
  contentHeight: number
}

export interface VlanStackOptions {
  /** Outer subnet size. Content stretches to fill it and never draws smaller than its minimum. */
  width?: number
  height?: number
  /** A domain the operator resized. That cell is at least this big. */
  domainSize?: ReadonlyMap<string, { width?: number; height?: number }>
  /** Domain pairs (`domainPairKey`) that have a relationship line between them. */
  linkedDomains?: ReadonlySet<string>
  /**
   * Parent-child pairs stack. Trusts sit in the next column.
   * When this is set, a line crosses the gap between those two boxes.
   */
  layoutLinks?: DomainLayoutLinks
}

export interface DomainLayoutLinks {
  /** Child fqdn → parent fqdn. The child is drawn under the parent. */
  parentOf: ReadonlyMap<string, string>
  /** Undirected trust pairs (`domainPairKey`). Drawn in neighboring columns. */
  trusts: ReadonlySet<string>
}

const VM_CARD_WIDTH = 220
const VM_CARD_MIN_H = 58
const VM_CARD_MAX_H = 140
/** Slightly wider than tall. A single column of domains is a strip; this pulls it toward a rectangle. */
const TARGET_ASPECT = 1.15

interface StackGroup {
  fqdn: string | null
  memberIds: string[]
  minWidth: number
  minHeight: number
  naturalWidth: number
  naturalHeight: number
}

function outerWidth(widths: readonly number[], gaps: readonly number[]): number {
  return VLAN_PAD * 2 + widths.reduce((sum, value) => sum + value, 0) + gaps.reduce((sum, value) => sum + value, 0)
}

function outerHeight(heights: readonly number[], gaps: readonly number[]): number {
  return (
    VLAN_HEADER +
    VLAN_PAD +
    heights.reduce((sum, value) => sum + value, 0) +
    gaps.reduce((sum, value) => sum + value, 0) +
    VLAN_PAD
  )
}

function groupsLinked(
  a: StackGroup | undefined,
  b: StackGroup | undefined,
  linked: ReadonlySet<string> | undefined,
): boolean {
  if (!a?.fqdn || !b?.fqdn || !linked) return false
  return linked.has(domainPairKey(a.fqdn, b.fqdn))
}

function columnGaps(groups: readonly StackGroup[], cols: number, linked: ReadonlySet<string> | undefined): number[] {
  const gaps: number[] = []
  const rows = Math.ceil(groups.length / Math.max(cols, 1))
  for (let col = 0; col < cols - 1; col++) {
    let gap = PACK_GAP
    for (let row = 0; row < rows; row++) {
      if (groupsLinked(groups[row * cols + col], groups[row * cols + col + 1], linked)) gap = LINK_GAP
    }
    gaps.push(gap)
  }
  return gaps
}

function rowGaps(groups: readonly StackGroup[], cols: number, linked: ReadonlySet<string> | undefined): number[] {
  const gaps: number[] = []
  const rows = Math.ceil(groups.length / Math.max(cols, 1))
  for (let row = 0; row < rows - 1; row++) {
    let gap = PACK_GAP
    for (let col = 0; col < cols; col++) {
      if (groupsLinked(groups[row * cols + col], groups[(row + 1) * cols + col], linked)) gap = LINK_GAP
    }
    gaps.push(gap)
  }
  return gaps
}

function columnMins(groups: readonly StackGroup[], cols: number): number[] {
  const widths = Array.from({ length: cols }, () => 0)
  for (let index = 0; index < groups.length; index++) {
    const col = index % cols
    widths[col] = Math.max(widths[col] ?? 0, groups[index]!.minWidth)
  }
  return widths
}

function rowMins(groups: readonly StackGroup[], cols: number): number[] {
  const rows = Math.ceil(groups.length / cols)
  const heights = Array.from({ length: rows }, () => 0)
  for (let index = 0; index < groups.length; index++) {
    const row = Math.floor(index / cols)
    heights[row] = Math.max(heights[row] ?? 0, groups[index]!.minHeight)
  }
  return heights
}

function spread(mins: readonly number[], extra: number): number[] {
  if (mins.length === 0) return []
  if (extra <= 0) return mins.map((value) => Math.round(value))
  const share = extra / mins.length
  const next = mins.map((value) => Math.round(value + share))
  const wanted = Math.round(mins.reduce((sum, value) => sum + value, 0) + extra)
  const drift = wanted - next.reduce((sum, value) => sum + value, 0)
  const last = next.length - 1
  next[last] = (next[last] ?? 0) + drift
  return next
}

function chooseColumns(groups: readonly StackGroup[]): number {
  let best = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let cols = 1; cols <= groups.length; cols++) {
    const score = Math.abs(
      outerWidth(columnMins(groups, cols), columnGaps(groups, cols, undefined)) /
        outerHeight(rowMins(groups, cols), rowGaps(groups, cols, undefined)) -
        TARGET_ASPECT,
    )
    if (score < bestScore) {
      bestScore = score
      best = cols
    }
  }
  return best
}

function columnsThatFit(groups: readonly StackGroup[], boxWidth: number | undefined): number {
  let cols = chooseColumns(groups)
  if (boxWidth == null || !Number.isFinite(boxWidth)) return cols
  while (cols > 1 && outerWidth(columnMins(groups, cols), columnGaps(groups, cols, undefined)) > boxWidth + 0.5) cols -= 1
  return cols
}

function orderGroups(groups: readonly StackGroup[], linked: ReadonlySet<string> | undefined): StackGroup[] {
  const remaining = [...groups]
  const ordered: StackGroup[] = []
  const linksAmong = (group: StackGroup, pool: readonly StackGroup[]) =>
    pool.reduce((count, other) => count + (groupsLinked(group, other, linked) ? 1 : 0), 0)
  while (remaining.length > 0) {
    let pick = 0
    if (ordered.length === 0) {
      pick = remaining.reduce(
        (best, group, index) => (linksAmong(group, remaining) > linksAmong(remaining[best]!, remaining) ? index : best),
        0,
      )
    } else {
      const last = ordered[ordered.length - 1]!
      const besideLast = remaining.findIndex((group) => groupsLinked(last, group, linked))
      if (besideLast >= 0) pick = besideLast
      else {
        const besideAny = remaining.findIndex((group) => ordered.some((placed) => groupsLinked(placed, group, linked)))
        if (besideAny >= 0) pick = besideAny
      }
    }
    ordered.push(remaining.splice(pick, 1)[0]!)
  }
  return ordered
}

function isTrust(a: StackGroup, b: StackGroup, links: DomainLayoutLinks | undefined): boolean {
  if (!a.fqdn || !b.fqdn || !links) return false
  return links.trusts.has(domainPairKey(a.fqdn, b.fqdn))
}

function isParentChild(a: StackGroup, b: StackGroup, links: DomainLayoutLinks | undefined): boolean {
  if (!a.fqdn || !b.fqdn || !links) return false
  return links.parentOf.get(a.fqdn) === b.fqdn || links.parentOf.get(b.fqdn) === a.fqdn
}

function verticalGap(above: StackGroup, below: StackGroup, links: DomainLayoutLinks | undefined): number {
  return isParentChild(above, below, links) ? VERTICAL_LINK_GAP : PACK_GAP
}

function columnGap(
  left: readonly StackGroup[],
  right: readonly StackGroup[],
  links: DomainLayoutLinks | undefined,
): number {
  const crosses = left.some((group) => right.some((other) => isTrust(group, other, links)))
  return crosses ? TRUST_GAP : PACK_GAP
}

function columnInnerHeight(column: readonly StackGroup[], links: DomainLayoutLinks | undefined): number {
  return column.reduce((sum, group, index) => {
    const gap = index === 0 ? 0 : verticalGap(column[index - 1]!, group, links)
    return sum + gap + group.minHeight
  }, 0)
}

function columnsWidth(columns: readonly (readonly StackGroup[])[], links: DomainLayoutLinks | undefined): number {
  if (columns.length === 0) return outerWidth([], [])
  const widths = columns.map((column) => Math.max(...column.map((group) => group.minWidth)))
  const gaps = columns.slice(0, -1).map((column, index) => columnGap(column, columns[index + 1] ?? [], links))
  return outerWidth(widths, gaps)
}

/** Parent and child share a column. A trust takes the next column, beside the domain it trusts. */
function arrangeGroups(
  groups: readonly StackGroup[],
  preferredCols: number,
  links: DomainLayoutLinks | undefined,
): StackGroup[][] {
  if (!links || (links.parentOf.size === 0 && links.trusts.size === 0)) {
    return packGroups(groups, preferredCols, undefined)
  }
  const domains = groups.filter((group) => group.fqdn)
  const loose = groups.filter((group) => !group.fqdn)
  const byFqdn = new Map(domains.map((group) => [group.fqdn!, group]))
  const parentOf = links.parentOf
  const placed = new Set<string>()
  const chainOf = (fqdn: string): StackGroup[] => {
    const group = byFqdn.get(fqdn)
    if (!group || placed.has(fqdn)) return []
    placed.add(fqdn)
    const children = [...parentOf.entries()]
      .filter(([, parent]) => parent === fqdn)
      .map(([child]) => child)
      .sort()
    return [group, ...children.flatMap((child) => chainOf(child))]
  }
  const roots = domains
    .map((group) => group.fqdn!)
    .filter((fqdn) => {
      const parent = parentOf.get(fqdn)
      return parent == null || !byFqdn.has(parent)
    })
    .sort()
  const chains: StackGroup[][] = []
  for (const root of roots) {
    const chain = chainOf(root)
    if (chain.length > 0) chains.push(chain)
  }
  for (const domain of domains) {
    if (placed.has(domain.fqdn!)) continue
    const chain = chainOf(domain.fqdn!)
    if (chain.length > 0) chains.push(chain)
  }
  const ordered: StackGroup[][] = []
  const used = new Set<number>()
  const trustsChain = (chain: readonly StackGroup[], other: readonly StackGroup[]) =>
    chain.some((group) => other.some((candidate) => isTrust(group, candidate, links)))
  while (used.size < chains.length) {
    let pick = -1
    if (ordered.length === 0) {
      chains.forEach((chain, index) => {
        if (used.has(index)) return
        if (pick < 0) {
          pick = index
          return
        }
        const chosen = chains[pick]!
        const longer = chain.length - chosen.length
        if (longer > 0 || (longer === 0 && (chain[0]?.fqdn ?? "") < (chosen[0]?.fqdn ?? ""))) pick = index
      })
    } else {
      const last = ordered[ordered.length - 1]!
      pick = chains.findIndex((chain, index) => !used.has(index) && trustsChain(last, chain))
      if (pick < 0) {
        pick = chains.findIndex(
          (chain, index) => !used.has(index) && ordered.some((column) => trustsChain(column, chain)),
        )
      }
      if (pick < 0) pick = chains.findIndex((_, index) => !used.has(index))
    }
    used.add(pick)
    ordered.push(chains[pick]!)
  }
  const columns = ordered.map((chain) => [...chain])
  for (const group of loose) {
    if (columns.length === 0) {
      columns.push([group])
      continue
    }
    const heights = columns.map((column) => columnInnerHeight(column, links))
    let target = 0
    heights.forEach((height, index) => {
      if (height < heights[target]!) target = index
    })
    const appendedHeight = columnInnerHeight([...columns[target]!, group], links)
    const stackedTallest = Math.max(...heights.map((height, index) => (index === target ? appendedHeight : height)))
    const besideTallest = Math.max(...heights, group.minHeight)
    const stackedScore = Math.abs(columnsWidth(columns, links) / stackedTallest - TARGET_ASPECT)
    const besideScore = Math.abs(columnsWidth([...columns, [group]], links) / besideTallest - TARGET_ASPECT)
    const shortestIsChain = (columns[target]?.length ?? 0) > 1
    if (besideScore + 0.05 < stackedScore || (shortestIsChain && columns.length < Math.max(preferredCols, 2))) {
      columns.push([group])
    } else {
      columns[target]!.push(group)
    }
  }
  return columns.filter((column) => column.length > 0)
}

/** Linked domains share a column so the line can leave to the side. The gap inside that column is only between the linked pair. */
function packGroups(
  groups: readonly StackGroup[],
  cols: number,
  linked: ReadonlySet<string> | undefined,
): StackGroup[][] {
  const columns: StackGroup[][] = Array.from({ length: Math.max(cols, 1) }, () => [])
  const weight = (column: readonly StackGroup[]) =>
    column.reduce((sum, group) => sum + group.minHeight, 0) + Math.max(0, column.length - 1) * PACK_GAP
  for (const group of orderGroups(groups, linked)) {
    let target = columns.findIndex((column) => column.some((placed) => groupsLinked(placed, group, linked)))
    if (target < 0) {
      target = 0
      for (let index = 1; index < columns.length; index++) {
        if (weight(columns[index]!) < weight(columns[target]!)) target = index
      }
    }
    columns[target]!.push(group)
  }
  return columns.filter((column) => column.length > 0)
}

function shouldFill(
  group: StackGroup,
  cellWidth: number,
  cellHeight: number,
  extraWidth: number,
  extraHeight: number,
): { width: boolean; height: boolean } {
  return {
    width: group.minWidth > group.naturalWidth + 1 || (extraWidth > 0 && cellWidth > group.naturalWidth + 1),
    height: group.minHeight > group.naturalHeight + 1 || (extraHeight > 0 && cellHeight > group.naturalHeight + 1),
  }
}

function placeDomainCards(
  ids: readonly string[],
  cellWidth: number,
  cellHeight: number,
  fillWidth: boolean,
  fillHeight: boolean,
): StackCard[] {
  const rows = Math.max(ids.length, 1)
  const cardWidth = fillWidth ? Math.max(VM_CARD_WIDTH, cellWidth - DOMAIN_PAD * 2) : VM_CARD_WIDTH
  let cardHeight: number | undefined
  let stride = VLAN_VM_STRIDE
  if (fillHeight) {
    const innerH = Math.max(VLAN_VM_STRIDE, cellHeight - DOMAIN_HEADER - DOMAIN_PAD * 2)
    const raw = (innerH - STACK_GAP * Math.max(0, rows - 1)) / rows
    cardHeight = Math.round(Math.min(VM_CARD_MAX_H, Math.max(VM_CARD_MIN_H, raw)))
    const used = rows * cardHeight + STACK_GAP * Math.max(0, rows - 1)
    const extraGap = rows > 1 ? Math.max(0, innerH - used) / (rows - 1) : 0
    stride = cardHeight + STACK_GAP + extraGap
  }
  return ids.map((id, row) => ({
    id,
    x: DOMAIN_PAD,
    y: Math.round(DOMAIN_HEADER + DOMAIN_PAD + row * stride),
    width: Math.round(cardWidth),
    height: cardHeight,
  }))
}

/** Cards inside one domain box. A box larger than the default card stretches the cards. */
export function layoutDomainMembers(memberIds: readonly string[], width: number, height: number): StackCard[] {
  return placeDomainCards(
    memberIds,
    width,
    height,
    width > DOMAIN_BOX_WIDTH + 1,
    height > domainGroupHeight(memberIds.length) + 1,
  )
}

function placeUnjoinedCards(
  ids: readonly string[],
  originX: number,
  originY: number,
  cellWidth: number,
  cellHeight: number,
  fillWidth: boolean,
  fillHeight: boolean,
): StackCard[] {
  const rows = Math.max(ids.length, 1)
  const cardWidth = fillWidth ? Math.max(VM_CARD_WIDTH, cellWidth) : VM_CARD_WIDTH
  let cardHeight: number | undefined
  let stride = VLAN_VM_STRIDE
  if (fillHeight) {
    const innerH = Math.max(VLAN_VM_STRIDE, cellHeight - UNJOINED_CAPTION)
    stride = innerH / rows
    cardHeight = Math.round(Math.min(VM_CARD_MAX_H, Math.max(VM_CARD_MIN_H, stride - STACK_GAP)))
  }
  return ids.map((id, row) => ({
    id,
    x: originX,
    y: Math.round(originY + UNJOINED_CAPTION + row * stride),
    width: Math.round(cardWidth),
    height: cardHeight,
  }))
}

/**
 * Subnet box contents. Domain boxes share the subnet in however many columns
 * keep the box near a rectangle. Hosts that are not joined stay in the subnet,
 * in their own cell, with a Not joined label.
 */
export function layoutVlanStack(
  vms: readonly { id: string; domainFqdn: string | null; ipLastOctet: number }[],
  options?: VlanStackOptions,
): VlanStack {
  const sorted = [...vms].sort((a, b) => a.ipLastOctet - b.ipLastOctet || a.id.localeCompare(b.id))
  const byDomain = new Map<string, string[]>()
  const unjoinedIds: string[] = []
  for (const vm of sorted) {
    if (vm.domainFqdn) {
      const list = byDomain.get(vm.domainFqdn) ?? []
      list.push(vm.id)
      byDomain.set(vm.domainFqdn, list)
    } else {
      unjoinedIds.push(vm.id)
    }
  }
  if (byDomain.size === 0) {
    const contentHeight = vlanGroupHeight(unjoinedIds.length)
    const askedW = options?.width ?? 0
    const askedH = options?.height ?? 0
    const width = Math.max(VLAN_GROUP_WIDTH, askedW)
    const height = Math.max(contentHeight, askedH)
    const fillW = askedW > VLAN_GROUP_WIDTH + 1
    const fillH = askedH > contentHeight + 1
    const rows = Math.max(unjoinedIds.length, 1)
    const cardW = fillW ? Math.max(VM_CARD_WIDTH, width - VLAN_PAD * 2) : VM_CARD_WIDTH
    const stride = fillH ? (height - VLAN_HEADER - VLAN_PAD * 2) / rows : VLAN_VM_STRIDE
    const cardH = fillH
      ? Math.round(Math.min(VM_CARD_MAX_H, Math.max(VM_CARD_MIN_H, stride - STACK_GAP)))
      : undefined
    return {
      domains: [],
      unjoined: unjoinedIds.map((id, row) => ({
        id,
        x: VLAN_PAD,
        y: Math.round(VLAN_HEADER + VLAN_PAD + row * stride),
        width: Math.round(cardW),
        height: cardH,
      })),
      unjoinedAt: null,
      unjoinedLabelX: VLAN_PAD,
      height,
      width,
      contentHeight,
    }
  }
  const groups: StackGroup[] = [...byDomain.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fqdn, memberIds]) => {
      const naturalWidth = DOMAIN_BOX_WIDTH
      const naturalHeight = domainGroupHeight(memberIds.length)
      const saved = options?.domainSize?.get(fqdn)
      return {
        fqdn,
        memberIds,
        naturalWidth,
        naturalHeight,
        minWidth: Math.max(naturalWidth, saved?.width ?? 0),
        minHeight: Math.max(naturalHeight, saved?.height ?? 0),
      }
    })
  if (unjoinedIds.length > 0) {
    const naturalHeight = UNJOINED_CAPTION + unjoinedIds.length * VLAN_VM_STRIDE
    groups.push({
      fqdn: null,
      memberIds: unjoinedIds,
      naturalWidth: DOMAIN_BOX_WIDTH,
      naturalHeight,
      minWidth: DOMAIN_BOX_WIDTH,
      minHeight: naturalHeight,
    })
  }
  const links = options?.layoutLinks ?? layoutLinksFromPairs(options?.linkedDomains)
  const columns = arrangeGroups(groups, columnsThatFit(groups, options?.width), links)
  const minCol = columns.map((column) => Math.max(...column.map((group) => group.minWidth)))
  const colGaps = columns.slice(0, -1).map((column, index) => columnGap(column, columns[index + 1] ?? [], links))
  // A parent-child line uses the band between the two faces. A trust uses the column gap.
  const columnSpan = (column: readonly StackGroup[]) => columnInnerHeight(column, links)
  const minSpans = columns.map(columnSpan)
  const minWidth = outerWidth(minCol, colGaps)
  const minHeight = VLAN_HEADER + VLAN_PAD + Math.max(...minSpans, 0) + VLAN_PAD
  const extraWidth = Math.max(0, (options?.width ?? 0) - minWidth)
  const extraHeight = Math.max(0, (options?.height ?? 0) - minHeight)
  const colW = spread(minCol, extraWidth)
  const domains: VlanStack["domains"] = []
  const unjoined: StackCard[] = []
  let unjoinedAt: number | null = null
  let unjoinedLabelX = VLAN_PAD
  let x = VLAN_PAD
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index]!
    const cellW = colW[index] ?? 0
    const heights = spread(
      column.map((group) => group.minHeight),
      extraHeight,
    )
    let y = VLAN_HEADER + VLAN_PAD
    column.forEach((group, row) => {
      if (row > 0) y += verticalGap(column[row - 1]!, group, links)
      const cellH = heights[row] ?? group.minHeight
      const fill = shouldFill(group, cellW, cellH, extraWidth, extraHeight)
      if (group.fqdn) {
        domains.push({
          fqdn: group.fqdn,
          memberIds: group.memberIds,
          x,
          y,
          width: cellW,
          height: cellH,
          members: placeDomainCards(group.memberIds, cellW, cellH, fill.width, fill.height),
        })
      } else {
        const cards = placeUnjoinedCards(group.memberIds, x, y, cellW, cellH, fill.width, fill.height)
        unjoined.push(...cards)
        const first = cards[0]
        unjoinedAt = first?.y ?? null
        const room = Math.max(VLAN_PAD, minWidth + extraWidth - UNJOINED_CAPTION_WIDTH - VLAN_PAD)
        unjoinedLabelX = Math.min(first?.x ?? x, room)
      }
      y += cellH
    })
    x += cellW + (colGaps[index] ?? PACK_GAP)
  }
  return {
    domains,
    unjoined,
    unjoinedAt,
    unjoinedLabelX,
    width: minWidth + extraWidth,
    height: minHeight + extraHeight,
    contentHeight: minHeight,
  }
}

export function vmsInDomain(graph: BuilderGraph, fqdn: string): BuilderVm[] {
  return graph.vms
    .filter((vm) => vm.domainFqdn === fqdn)
    .sort((a, b) => a.ipLastOctet - b.ipLastOctet || a.id.localeCompare(b.id))
}

export function vlanCidr(vlan: number, rangeNumber: number | null): string | null {
  if (rangeNumber == null) return null
  return `10.${rangeNumber}.${vlan}.0/24`
}

/**
 * Match a config VM to a live Proxmox VM. Ludus stores `{{ range_id }}` in the
 * config and the concrete range id on the VM name.
 */
export function matchLiveVm(
  vm: { vmName: string; hostname: string },
  rangeId: string,
  live: readonly LiveVmRow[],
): LiveVmRow | null {
  const expand = (value: string) => value.replace(/\{\{\s*range_id\s*\}\}/g, rangeId)
  const wanted = new Set([expand(vm.vmName), expand(vm.hostname)].map((name) => name.trim()).filter(Boolean))
  return live.find((row) => wanted.has(row.name)) ?? null
}

function layoutLinksFromPairs(pairs: ReadonlySet<string> | undefined): DomainLayoutLinks | undefined {
  if (!pairs || pairs.size === 0) return undefined
  const parentOf = new Map<string, string>()
  for (const key of pairs) {
    const [parent, child] = key.split("\0")
    if (!parent || !child) continue
    parentOf.set(child, parent)
  }
  return { parentOf, trusts: new Set() }
}

/** Domain pairs that have a trust or a parent-child line. */
export function linkedDomainsIn(graph: Pick<BuilderGraph, "trusts" | "domains">): Set<string> {
  const linked = new Set<string>()
  const add = (a: string | null | undefined, b: string | null | undefined) => {
    if (!a || !b || a === b) return
    linked.add(domainPairKey(a, b))
  }
  for (const trust of graph.trusts) add(trust.fromFqdn, trust.toFqdn)
  for (const domain of graph.domains) add(domain.fqdn, domain.childOfFqdn)
  return linked
}

/** Parent-child pairs stack. Trusts are placed beside the domain they join. */
export function domainLayoutLinks(graph: Pick<BuilderGraph, "trusts" | "domains">): DomainLayoutLinks {
  const parentOf = new Map<string, string>()
  for (const domain of graph.domains) {
    if (domain.childOfFqdn && domain.childOfFqdn !== domain.fqdn) parentOf.set(domain.fqdn, domain.childOfFqdn)
  }
  const trusts = new Set<string>()
  for (const trust of graph.trusts) {
    if (!trust.fromFqdn || !trust.toFqdn || trust.fromFqdn === trust.toFqdn) continue
    if (parentOf.get(trust.fromFqdn) === trust.toFqdn || parentOf.get(trust.toFqdn) === trust.fromFqdn) continue
    trusts.add(domainPairKey(trust.fromFqdn, trust.toFqdn))
  }
  return { parentOf, trusts }
}

function vlansShareRule(graph: BuilderGraph, a: number, b: number): boolean {
  return graph.rules.some((rule) => {
    const src = rule.vlan_src
    const dst = rule.vlan_dst
    return (src === a && dst === b) || (src === b && dst === a)
  })
}

/**
 * Column-per-VLAN layout. VM positions are relative to their VLAN group.
 * Saved flat-canvas coordinates are not used for VMs; a machine stays in its VLAN.
 */
export function computeDefaultLayout(graph: BuilderGraph): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  const colWidth = 232
  const top = 140

  out[ROUTER_NODE_ID] = { x: 40, y: 24 }
  out[endpointNodeId("wireguard")] = { x: 208, y: 24 }
  out[endpointNodeId("public")] = { x: 376, y: 24 }

  let tallest = vlanGroupHeight(1)
  let cursor = 40
  let previousVlan: number | null = null
  for (const vlan of graph.vlans) {
    const members = vmsInVlan(graph, vlan)
    const stack = layoutVlanStack(members, { layoutLinks: domainLayoutLinks(graph) })
    tallest = Math.max(tallest, stack.height)
    if (previousVlan != null) cursor += vlansShareRule(graph, previousVlan, vlan.vlan) ? LINK_GAP : PACK_GAP
    out[vlanNodeId(vlan.vlan)] = { x: cursor, y: top }
    cursor += stack.width
    previousVlan = vlan.vlan
    members.forEach((vm, row) => {
      out[vm.id] = defaultVmPosition(row)
    })
  }

  const domainY = top + tallest + PACK_GAP
  graph.domains.forEach((domain: BuilderDomain, i) => {
    out[domainNodeId(domain.fqdn)] = { x: 40 + i * colWidth, y: domainY }
  })

  graph.vms.forEach((vm: BuilderVm, i) => {
    if (!out[vm.id]) out[vm.id] = { x: 40, y: domainY + 140 + i * VLAN_VM_STRIDE }
  })

  return out
}

export function vmAddress(vm: BuilderVm, rangeNumber: number | null): string {
  if (rangeNumber == null) return `v${vm.vlan}.${vm.ipLastOctet}`
  return `10.${rangeNumber}.${vm.vlan}.${vm.ipLastOctet}`
}

const RANGE_ID_TOKEN = /\{\{\s*range_id\s*\}\}/i

/** Show `{{ range_id }}-elk` as `jd-elk` once the range id is known. */
export function expandRangeId(value: string, rangeId: string): string {
  if (!rangeId) return value
  return value.replace(/\{\{\s*range_id\s*\}\}/gi, rangeId)
}

/**
 * Write the range id back to the placeholder when the operator kept it.
 * A copied range still substitutes its own id.
 */
export function restoreRangeId(edited: string, original: string, rangeId: string): string {
  if (!rangeId || !RANGE_ID_TOKEN.test(original)) return edited
  const expanded = expandRangeId(original, rangeId)
  if (edited === expanded) return original
  if (!edited.startsWith(rangeId) || !expanded.startsWith(rangeId)) return edited
  return `{{ range_id }}${edited.slice(rangeId.length)}`
}

/** Saved size, or the content minimum when the operator has not resized the box. */
export function savedBoxSize(
  layout: Record<string, { width?: number; height?: number } | undefined>,
  id: string,
  minWidth: number,
  minHeight: number,
): { width: number; height: number } {
  const saved = layout[id]
  return {
    width: saved?.width != null && saved.width >= minWidth ? saved.width : minWidth,
    height: saved?.height != null && saved.height >= minHeight ? saved.height : minHeight,
  }
}
