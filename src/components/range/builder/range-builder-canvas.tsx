"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Panel,
  useReactFlow,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Connection,
  type NodeChange,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Shrink } from "lucide-react"
import {
  type RangeDocument,
  type BuilderGraph,
  type Finding,
  addVmFromTemplate,
  moveVmToVlan,
  setDomainMembership,
  setNetworkRules,
  addForestTrust,
  childDomainFromRoles,
  nextFreeVlan,
  removeVm,
  removeForestTrust,
  vmTestingFlag,
} from "@/lib/range/range-builder-document"
import { firewallMirrorIndex, type NetworkRule, type VlanValue } from "@/lib/range/network-rules"
import type { RangeBuilderLayout } from "@/lib/range/range-builder-layout-store"
import { builderNodeTypes } from "./builder-nodes"
import { bindBuilderEdgeActivate, builderEdgeTypes } from "./builder-edge"
import { FirewallRuleDialog } from "./firewall-rule-dialog"
import { domainVlanFromNodeId, hostDropTarget, type DropRect } from "./builder-move"
import { laneKey, linkHandles, trustAcronym, trustLabel, trustLinks, type DiagramBox } from "./builder-routing"
import { RangeBuilderInspector } from "./range-builder-inspector"
import { RangeBuilderPalette } from "./range-builder-palette"
import {
  PALETTE_DND_MIME,
  type PaletteDragPayload,
  type BuilderNode,
  type BuilderNodeData,
  type BuilderEdge,
  type BuilderSelection,
  type TemplateRow,
  type GoadBuilderContext,
  computeDefaultLayout,
  vlanNodeId,
  domainNodeId,
  domainFqdnFromNodeId,
  endpointNodeId,
  ROUTER_NODE_ID,
  VLAN_GROUP_WIDTH,
  vlanGroupHeight,
  savedBoxSize,
  layoutDomainMembers,
  layoutVlanStack,
  domainLayoutLinks,
  type VlanStack,
  vmsInVlan,
  vlanCidr,
  vmAddress,
  matchLiveVm,
  type RouterDetails,
  type InternetState,
  type BuilderKind,
  type BuilderSurface,
  type BlueprintPaletteItem,
  type LiveVmRow,
} from "./builder-types"

type Notify = (opts: { variant?: "default" | "destructive"; title: string; description?: string }) => void

export interface RangeBuilderCanvasProps {
  doc: RangeDocument
  graph: BuilderGraph
  apply: (fn: (doc: RangeDocument) => RangeDocument) => void
  findings: Finding[]
  rangeNumber: number | null
  builtTemplates: TemplateRow[]
  allTemplates: TemplateRow[]
  templatesLoading: boolean
  goad: GoadBuilderContext | null
  locked: boolean
  layout: RangeBuilderLayout
  onLayoutChange: (patch: RangeBuilderLayout) => void
  onLayoutRetarget: (fromId: string, toId: string) => void
  /** Packed positions with no saved box sizes. */
  onLayoutCompact: (positions: RangeBuilderLayout) => void
  /** Drop width and height so the next layout fills the subnet again. */
  onLayoutClearSizes: (ids: string[]) => void
  notify: Notify
  /** Range testing mode is on: VMs are snapshotted and internet is blocked. */
  testingEnabled: boolean
  /** False until range status has loaded, so the banner does not claim internet is on early. */
  statusLoaded: boolean
  /** Bumped by Reset so the canvas drops its selection and placeholders. */
  resetNonce: number
  routerDetails: RouterDetails
  /** Ludus draws VLAN boxes. GOAD draws domain boxes. */
  kind: BuilderKind
  /** Composer before the first deploy; viewer after, still editable. */
  surface: BuilderSurface
  rangeId: string
  liveVms: LiveVmRow[]
  blueprints: BlueprintPaletteItem[]
  blueprintsLoading: boolean
  blueprintsError: boolean
  onLoadBlueprint: (blueprint: BlueprintPaletteItem) => void
  blueprintBusyId: string | null
  /** Extension VMs drawn before deploy. */
  pendingVmIds?: ReadonlySet<string>
  hasLudusSources: boolean
}

function absoluteRect(nodes: readonly BuilderNode[], node: BuilderNode): DropRect {
  const origin = diagramOrigin(nodes, node.id)
  const vm = node.data.kind === "vm"
  return {
    id: node.id,
    x: origin.x,
    y: origin.y,
    width: px(node.measured?.width ?? node.width, px(node.style?.width, vm ? 220 : 200)),
    height: px(node.measured?.height ?? node.height, px(node.style?.height, vm ? 52 : 80)),
  }
}

function diagramOrigin(nodes: readonly BuilderNode[], id: string): { x: number; y: number } {
  let x = 0
  let y = 0
  const seen = new Set<string>()
  let currentId: string | undefined = id
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const node = nodes.find((entry) => entry.id === currentId)
    if (!node) break
    x += node.position.x
    y += node.position.y
    currentId = node.parentId
  }
  return { x, y }
}

function isDiagramBox(id: string): boolean {
  return id.startsWith("vlan:") || id.startsWith("domain:") || id.startsWith("endpoint:")
}

function px(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function nodeBox(node: BuilderNode, fallbackWidth: number, fallbackHeight: number): { width: number; height: number } {
  return {
    width: px(node.width, px(node.style?.width, fallbackWidth)),
    height: px(node.height, px(node.style?.height, fallbackHeight)),
  }
}

/** Move the domains and machines inside a subnet to match a box that is being resized. */
function applyLiveStack(
  nodes: BuilderNode[],
  vlanId: string,
  vlanNumber: number,
  stack: VlanStack,
  resizedId: string,
): BuilderNode[] {
  const updates = new Map<string, BuilderNode>()
  const vlan = nodes.find((node) => node.id === vlanId)
  if (vlan && vlan.data.kind === "vlan") {
    const resizingVlan = vlan.id === resizedId
    updates.set(vlanId, {
      ...vlan,
      ...(resizingVlan
        ? {}
        : {
            width: stack.width,
            height: stack.height,
            style: { width: stack.width, height: stack.height },
          }),
      data: {
        ...vlan.data,
        unjoinedAt: stack.unjoinedAt,
        unjoinedLabelX: stack.unjoinedLabelX,
        boxHeight: stack.contentHeight,
      },
    })
  }
  for (const entry of stack.domains) {
    const id = domainNodeId(entry.fqdn, vlanNumber)
    const node = nodes.find((item) => item.id === id)
    if (node && node.data.kind === "domain" && id !== resizedId) {
      updates.set(id, {
        ...node,
        position: { x: entry.x, y: entry.y },
        width: entry.width,
        height: entry.height,
        style: { width: entry.width, height: entry.height },
      })
    }
    const domainNode = nodes.find((item) => item.id === id)
    const domainWidth = id === resizedId && domainNode ? nodeBox(domainNode, entry.width, entry.height).width : entry.width
    const domainHeight = id === resizedId && domainNode ? nodeBox(domainNode, entry.width, entry.height).height : entry.height
    const members = id === resizedId ? layoutDomainMembers(entry.memberIds, domainWidth, domainHeight) : entry.members
    for (const member of members) {
      const vm = nodes.find((item) => item.id === member.id)
      if (!vm || vm.data.kind !== "vm") continue
      updates.set(member.id, {
        ...vm,
        position: { x: member.x, y: member.y },
        data: { ...vm.data, cardWidth: member.width, cardHeight: member.height },
      })
    }
  }
  for (const slot of stack.unjoined) {
    const vm = nodes.find((item) => item.id === slot.id)
    if (!vm || vm.data.kind !== "vm") continue
    updates.set(slot.id, {
      ...vm,
      position: { x: slot.x, y: slot.y },
      data: { ...vm.data, cardWidth: slot.width, cardHeight: slot.height },
    })
  }
  if (updates.size === 0) return nodes
  return nodes.map((node) => updates.get(node.id) ?? node)
}

/** Preview the contents of a subnet or domain while its resize handle is still held. */
function reflowLiveBox(nodes: BuilderNode[], graph: BuilderGraph, resizedId: string): BuilderNode[] {
  const node = nodes.find((item) => item.id === resizedId)
  if (!node) return nodes
  if (node.data.kind === "domain") {
    const fqdn = node.data.domain.fqdn
    const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : undefined
    const vlanNumber = parent && parent.data.kind === "vlan" ? parent.data.vlan : null
    const ordered = graph.vms
      .filter((vm) => vm.domainFqdn === fqdn && (vlanNumber == null || vm.vlan === vlanNumber))
      .map((vm) => vm.id)
    const box = nodeBox(node, VLAN_GROUP_WIDTH, 120)
    const cards = new Map(layoutDomainMembers(ordered, box.width, box.height).map((card) => [card.id, card]))
    return nodes.map((item) => {
      const card = cards.get(item.id)
      if (card && item.data.kind === "vm") {
        return {
          ...item,
          position: { x: card.x, y: card.y },
          data: { ...item.data, cardWidth: card.width, cardHeight: card.height },
        }
      }
      if (parent && item.id === parent.id && item.data.kind === "vlan") {
        const current = nodeBox(item, VLAN_GROUP_WIDTH, 120)
        const width = Math.max(current.width, node.position.x + box.width + 12)
        const height = Math.max(current.height, node.position.y + box.height + 12)
        if (width === current.width && height === current.height) return item
        return { ...item, width, height, style: { width, height } }
      }
      return item
    })
  }
  if (node.data.kind !== "vlan") return nodes
  const vlan = node.data.vlan
  const box = nodeBox(node, VLAN_GROUP_WIDTH, 120)
  const stack = layoutVlanStack(
    graph.vms.filter((vm) => vm.vlan === vlan),
    { width: box.width, height: box.height, layoutLinks: domainLayoutLinks(graph) },
  )
  return applyLiveStack(nodes, node.id, vlan, stack, resizedId)
}

function descendantIds(nodes: readonly BuilderNode[], rootId: string): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.parentId !== rootId) continue
    ids.push(node.id, ...descendantIds(nodes, node.id))
  }
  return ids
}

function boxOf(nodes: readonly BuilderNode[], id: string): DiagramBox | null {
  if (!isDiagramBox(id)) return null
  const node = nodes.find((entry) => entry.id === id)
  if (!node) return null
  const origin = diagramOrigin(nodes, id)
  const endpoint = id.startsWith("endpoint:")
  return {
    x: origin.x,
    y: origin.y,
    width: px(node.measured?.width ?? node.width, px(node.style?.width, node.initialWidth ?? (endpoint ? 120 : VLAN_GROUP_WIDTH))),
    height: px(node.measured?.height ?? node.height, px(node.style?.height, node.initialHeight ?? (endpoint ? 28 : 80))),
  }
}

function vlanEndpointNodeId(v: VlanValue): string | null {
  if (v === "wireguard") return endpointNodeId("wireguard")
  if (v === "public") return endpointNodeId("public")
  if (v === "all") return null
  return vlanNodeId(v)
}

function selectionNodeId(selection: BuilderSelection): string | null {
  switch (selection.kind) {
    case "vm":
      return selection.vmId
    case "vlan":
      return vlanNodeId(selection.vlan)
    case "domain":
      return domainNodeId(selection.fqdn)
    case "router":
      return ROUTER_NODE_ID
    case "none":
    case "rule":
    case "trust":
    case "depends":
      return null
    default: {
      const unreachable: never = selection
      return unreachable
    }
  }
}

function selectNodes(nodes: BuilderNode[], selection: BuilderSelection): BuilderNode[] {
  const id = selectionNodeId(selection)
  if (!id) return nodes
  return nodes.map((node) =>
    node.id === id || node.id.startsWith(`${id}@`) ? { ...node, selected: true } : node,
  )
}

function findingsOn(findings: readonly Finding[], nodeId: string): Finding[] {
  return findings.filter(
    (finding) =>
      finding.nodeId === nodeId || (finding.nodeId != null && nodeId.startsWith(`${finding.nodeId}@`)),
  )
}

function errorMessages(findings: readonly Finding[], nodeId: string): string[] {
  return findingsOn(findings, nodeId)
    .filter((finding) => finding.level === "error")
    .map((finding) => finding.message)
}

function actionColor(action: NetworkRule["action"]): string {
  if (action === "ACCEPT") return "#22c55e"
  if (action === "REJECT") return "#ef4444"
  return "#f97316"
}

function RangeBuilderFlow(props: RangeBuilderCanvasProps) {
  const {
    doc,
    graph,
    apply,
    findings,
    rangeNumber,
    builtTemplates,
    allTemplates,
    templatesLoading,
    goad,
    locked,
    layout,
    onLayoutChange,
    onLayoutRetarget,
    onLayoutCompact,
    onLayoutClearSizes,
    notify,
    testingEnabled,
    statusLoaded,
    resetNonce,
    routerDetails,
    kind,
    surface,
    rangeId,
    liveVms,
    pendingVmIds,
    blueprints,
    blueprintsLoading,
    blueprintsError,
    onLoadBlueprint,
    blueprintBusyId,
    hasLudusSources,
  } = props

  const { screenToFlowPosition, getIntersectingNodes, getNodes, fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>([])
  const [fittedRangeId, setFittedRangeId] = useState<string | null>(null)
  const presented = fittedRangeId === rangeId
  const fitWaitStarted = useRef<{ rangeId: string; at: number } | null>(null)
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>([])
  const [selection, setSelection] = useState<BuilderSelection>({ kind: "none" })
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const suppressPaneClick = useRef(false)
  const selectedEdgeIdRef = useRef<string | null>(null)
  // Canvas-only placeholders for empty VLANs/domains (not yet in range-config).
  const [placeholderVlans, setPlaceholderVlans] = useState<number[]>([])
  const [placeholderDomains, setPlaceholderDomains] = useState<string[]>([])
  const [domainPins, setDomainPins] = useState<Record<string, number>>({})
  const [pendingRule, setPendingRule] = useState<NetworkRule | null>(null)
  // Session-only positions inside a group. Saved layouts from the flat canvas are not used.
  const [vmOffsets, setVmOffsets] = useState<Record<string, { x: number; y: number }>>({})
  const wrapperRef = useRef<HTMLDivElement>(null)
  const kindRef = useRef(kind)

  const externalDefault = graph.networkDefaults.external_default
  const firewallBlocksInternet = externalDefault === "REJECT" || externalDefault === "DROP"
  const internet: InternetState | null = !statusLoaded
    ? firewallBlocksInternet
      ? "firewall"
      : null
    : testingEnabled
      ? "testing"
      : firewallBlocksInternet
        ? "firewall"
        : "on"

  useEffect(() => {
    setSelection({ kind: "none" })
    setPlaceholderVlans([])
    setPlaceholderDomains([])
    setDomainPins({})
    setPendingRule(null)
    setVmOffsets({})
  }, [resetNonce])

  // Relative offsets from one grouping do not apply to the other.
  useEffect(() => {
    setVmOffsets({})
  }, [kind])

  useEffect(() => {
    if (kindRef.current === kind) return
    kindRef.current = kind
    const timer = setTimeout(() => fitView({ duration: 200 }), 60)
    return () => clearTimeout(timer)
  }, [kind, fitView])

  // Hide the first paint until the boxes have been measured and the view has been fitted.
  useEffect(() => {
    if (presented || nodes.length === 0) return
    if (fitWaitStarted.current?.rangeId !== rangeId) fitWaitStarted.current = { rangeId, at: Date.now() }
    const elapsed = Date.now() - (fitWaitStarted.current?.at ?? Date.now())
    let cancelled = false
    const timer = window.setTimeout(() => {
      void Promise.resolve(fitView({ duration: 0, padding: 0.2 })).then(() => {
        if (!cancelled) setFittedRangeId(rangeId)
      })
    }, elapsed > 500 ? 0 : 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [fitView, nodes, presented, rangeId])

  const positionFor = useCallback(
    (id: string, fallback: Record<string, { x: number; y: number }>) =>
      layout[id] ?? fallback[id] ?? { x: 40, y: 40 },
    [layout],
  )

  // Rebuild on every doc edit. Groups own their VMs (relative positions).
  // A saved layout is used for the router, endpoints, and group boxes — not VMs.
  useEffect(() => {
    const defaults = computeDefaultLayout(graph)
    const built: BuilderNode[] = []
    built.push({
      id: ROUTER_NODE_ID,
      type: "router",
      position: positionFor(ROUTER_NODE_ID, defaults),
      zIndex: 3,
      data: { kind: "router", router: graph.router },
    })
    for (const ep of ["wireguard", "public"] as const) {
      built.push({
        id: endpointNodeId(ep),
        type: "endpoint",
        position: positionFor(endpointNodeId(ep), defaults),
        zIndex: 3,
        data: {
          kind: "endpoint",
          endpoint: ep,
          internet: ep === "public" ? internet ?? undefined : undefined,
        },
      })
    }
    const colWidth = 232
    let stacksBottom = 140
    const domainAnchor = new Map<string, string>()
    const vmSlot = new Map<
      string,
      {
        parentId: string
        position: { x: number; y: number }
        parentWidth: number
        parentHeight: number
        cardWidth?: number
        cardHeight?: number
      }
    >()

    const realVlans = new Set(graph.vlans.map((v) => v.vlan))
    graph.vlans.forEach((vlan, index) => {
      const members = vmsInVlan(graph, vlan)
      const id = vlanNodeId(vlan.vlan)
      const vlanPos = positionFor(id, defaults)
      const domainSize = new Map<string, { width?: number; height?: number }>()
      for (const vm of members) {
        if (!vm.domainFqdn || domainSize.has(vm.domainFqdn)) continue
        const saved = layout[domainNodeId(vm.domainFqdn, vlan.vlan)]
        if (saved?.width == null && saved?.height == null) continue
        domainSize.set(vm.domainFqdn, { width: saved.width, height: saved.height })
      }
      const savedVlan = layout[id]
      const stack = layoutVlanStack(members, {
        width: savedVlan?.width && savedVlan.width > 0 ? savedVlan.width : undefined,
        height: savedVlan?.height && savedVlan.height > 0 ? savedVlan.height : undefined,
        domainSize,
        layoutLinks: domainLayoutLinks(graph),
      })
      stacksBottom = Math.max(stacksBottom, vlanPos.y + stack.height)
      built.push({
        id,
        type: "vlan",
        position: vlanPos,
        zIndex: 0,
        width: stack.width,
        height: stack.height,
        initialWidth: stack.width,
        initialHeight: stack.height,
        style: { width: stack.width, height: stack.height },
        data: {
          kind: "vlan",
          vlan: vlan.vlan,
          count: members.length,
          subnet: vlanCidr(vlan.vlan, rangeNumber),
          tone: index,
          shared: false,
          unjoinedAt: stack.unjoinedAt,
          unjoinedLabelX: stack.unjoinedLabelX,
          boxHeight: stack.contentHeight,
        },
      })
      for (const entry of stack.domains) {
        const nodeId = domainNodeId(entry.fqdn, vlan.vlan)
        const domain = graph.domains.find((item) => item.fqdn === entry.fqdn) ?? {
          fqdn: entry.fqdn,
          vmIds: entry.memberIds,
          primaryDcVmId: null,
          childOfFqdn: null,
        }
        const containsPrimary = domain.primaryDcVmId != null && entry.memberIds.includes(domain.primaryDcVmId)
        if (!domainAnchor.has(entry.fqdn) || containsPrimary) domainAnchor.set(entry.fqdn, nodeId)
        const dragged = vmOffsets[nodeId]
        const messages = errorMessages(findings, nodeId)
        built.push({
          id: nodeId,
          type: "domain",
          parentId: id,
          ...(kind === "ludus" ? {} : { extent: "parent" as const, expandParent: true }),
          zIndex: 1,
          position: dragged ?? { x: entry.x, y: entry.y },
          width: entry.width,
          height: entry.height,
          initialWidth: entry.width,
          initialHeight: entry.height,
          style: { width: entry.width, height: entry.height },
          data: {
            kind: "domain",
            domain,
            locked,
            hasError: messages.length > 0,
            messages,
            grouped: true,
            count: entry.memberIds.length,
            subnet: null,
          },
        })
        for (const member of entry.members) {
          vmSlot.set(member.id, {
            parentId: nodeId,
            position: { x: member.x, y: member.y },
            parentWidth: entry.width,
            parentHeight: entry.height,
            cardWidth: member.width,
            cardHeight: member.height,
          })
        }
      }
      for (const slot of stack.unjoined) {
        vmSlot.set(slot.id, {
          parentId: id,
          position: { x: slot.x, y: slot.y },
          parentWidth: stack.width,
          parentHeight: stack.height,
          cardWidth: slot.width,
          cardHeight: slot.height,
        })
      }
    })
    placeholderVlans.forEach((v, index) => {
      if (realVlans.has(v)) return
      const id = vlanNodeId(v)
      const height = vlanGroupHeight(0)
      const placeholderSize = savedBoxSize(layout, id, VLAN_GROUP_WIDTH, height)
      built.push({
        id,
        type: "vlan",
        position: positionFor(id, {
          [id]: { x: 40 + (graph.vlans.length + index) * colWidth, y: 140 },
        }),
        zIndex: 0,
        width: placeholderSize.width,
        height: placeholderSize.height,
        initialWidth: placeholderSize.width,
        initialHeight: placeholderSize.height,
        style: { width: placeholderSize.width, height: placeholderSize.height },
        data: {
          kind: "vlan",
          vlan: v,
          count: 0,
          subnet: vlanCidr(v, rangeNumber),
          tone: graph.vlans.length + index,
          shared: false,
          unjoinedAt: null,
          boxHeight: height,
        },
      })
    })

    const placedDomains = new Set(domainAnchor.keys())
    const realDomains = new Set(graph.domains.map((d) => d.fqdn))
    graph.domains.forEach((domain, index) => {
      if (placedDomains.has(domain.fqdn)) return
      const id = domainNodeId(domain.fqdn)
      const floatingSize = savedBoxSize(layout, id, 220, 84)
      const messages = errorMessages(findings, id)
      built.push({
        id,
        type: "domain",
        position: positionFor(id, {
          [id]: { x: 40 + index * colWidth, y: stacksBottom + 48 },
        }),
        width: floatingSize.width,
        height: floatingSize.height,
        initialWidth: floatingSize.width,
        initialHeight: floatingSize.height,
        style: { width: floatingSize.width, height: floatingSize.height },
        data: {
          kind: "domain",
          domain,
          locked,
          hasError: messages.length > 0,
          messages,
          grouped: false,
          count: graph.vms.filter((vm) => vm.domainFqdn === domain.fqdn).length,
          subnet: null,
        },
      })
    })
    placeholderDomains.forEach((fqdn, index) => {
      if (realDomains.has(fqdn)) return
      const id = domainNodeId(fqdn)
      const placeholderSize = savedBoxSize(layout, id, 220, 84)
      const pin = domainPins[fqdn]
      const home = pin == null ? undefined : built.find((node) => node.id === vlanNodeId(pin))
      const domainData = {
        kind: "domain" as const,
        domain: { fqdn, vmIds: [] as string[], primaryDcVmId: null, childOfFqdn: null },
        locked,
        hasError: false,
        grouped: home != null,
        count: 0,
        subnet: null,
      }
      if (home) {
        const homeHeight = px(home.height, 120)
        built.push({
          id,
          type: "domain",
          parentId: home.id,
          zIndex: 1,
          position: vmOffsets[id] ?? { x: 12, y: Math.max(48, homeHeight - placeholderSize.height - 12) },
          width: placeholderSize.width,
          height: placeholderSize.height,
          initialWidth: placeholderSize.width,
          initialHeight: placeholderSize.height,
          style: { width: placeholderSize.width, height: placeholderSize.height },
          data: domainData,
        })
        return
      }
      built.push({
        id,
        type: "domain",
        position: positionFor(id, {
          [id]: { x: 40 + (graph.domains.length + index) * colWidth, y: stacksBottom + 48 },
        }),
        width: placeholderSize.width,
        height: placeholderSize.height,
        initialWidth: placeholderSize.width,
        initialHeight: placeholderSize.height,
        style: { width: placeholderSize.width, height: placeholderSize.height },
        data: domainData,
      })
    })

    for (const vm of graph.vms) {
      const pending = pendingVmIds?.has(vm.id) === true
      const vmLocked = locked && isLabVm(vm.id, goad) && !pending
      const slot = vmSlot.get(vm.id)
      const dragged = slot ? vmOffsets[vm.id] : undefined
      const draggedInside =
        slot != null &&
        dragged != null &&
        dragged.x >= 0 &&
        dragged.x <= slot.parentWidth - 180 &&
        dragged.y >= 0 &&
        dragged.y < slot.parentHeight
      const live = matchLiveVm(vm, rangeId, liveVms)
      const presence = surface !== "viewer" ? null : live ? (live.poweredOn ? "on" : "off") : "missing"
      const messages = errorMessages(findings, vm.id)
      built.push({
        id: vm.id,
        type: "vm",
        parentId: slot?.parentId,
        extent: slot && kind !== "ludus" ? "parent" : undefined,
        zIndex: slot ? 2 : undefined,
        position: slot
          ? (draggedInside && dragged ? dragged : slot.position)
          : positionFor(vm.id, defaults),
        data: {
          kind: "vm",
          vm,
          hasError: messages.length > 0,
          messages,
          locked: vmLocked,
          address: vmAddress(vm, rangeNumber),
          keepsInternet: !vmTestingFlag(vm, "block_internet"),
          presence,
          cardWidth: slot?.cardWidth,
          cardHeight: slot?.cardHeight,
          pending,
        },
      })
    }

    setNodes(selectNodes(built, selectionRef.current))

    const builtEdges: BuilderEdge[] = []
    const nodeIds = new Set(built.map((node) => node.id))
    let route = 0
    const routed = () => {
      const offset = 18 + (route % 4) * 14
      route += 1
      return { type: "smoothstep" as const, pathOptions: { offset, borderRadius: 8 } }
    }
    const resolveEndpoint = (value: VlanValue): string | null =>
      typeof value === "number" ? vlanNodeId(value) : vlanEndpointNodeId(value)

    for (const vlan of graph.vlans) {
      const target = vlanNodeId(vlan.vlan)
      if (!nodeIds.has(target)) continue
      builtEdges.push({
        id: `gw:${vlan.vlan}`,
        source: ROUTER_NODE_ID,
        sourceHandle: "down",
        target,
        targetHandle: "in-top",
        ...routed(),
        label: "Gateway",
        data: { kind: "gateway", shortLabel: "GW" },
        selectable: false,
        style: { stroke: "#64748b", strokeWidth: 1.5 },
      })
    }

    const obstaclesFor = (sourceId: string, targetId: string) =>
      built.flatMap((node) => {
        if (node.id === sourceId || node.id === targetId || !isDiagramBox(node.id)) return []
        const box = boxOf(built, node.id)
        return box ? [box] : []
      })

    const laneCounts = new Map<string, number>()
    const takeLane = (sourceId: string, targetId: string) => {
      const sourceBox = boxOf(built, sourceId)
      const targetBox = boxOf(built, targetId)
      const key =
        sourceBox && targetBox
          ? laneKey(linkHandles(sourceBox, targetBox).channel, sourceBox, targetBox)
          : sourceId < targetId
            ? `${sourceId}~${targetId}`
            : `${targetId}~${sourceId}`
      const lane = laneCounts.get(key) ?? 0
      laneCounts.set(key, lane + 1)
      const linked =
        sourceBox && targetBox
          ? linkHandles(sourceBox, targetBox)
          : {
              sourceHandle: sourceBox ? ("out" as const) : undefined,
              targetHandle: targetBox ? ("in" as const) : undefined,
            }
      return { ...linked, lane }
    }

    const paired = new Set<number>()
    graph.rules.forEach((rule, index) => {
      if (paired.has(index)) return
      const src = resolveEndpoint(rule.vlan_src)
      const dst = resolveEndpoint(rule.vlan_dst)
      if (!src || !dst) return
      if (!nodeIds.has(src) || !nodeIds.has(dst)) return
      const mirror = firewallMirrorIndex(graph.rules, index)
      const bidirectional = mirror !== -1 && !paired.has(mirror)
      if (bidirectional) paired.add(mirror)
      const color = actionColor(rule.action)
      const lane = takeLane(src, dst)
      builtEdges.push({
        id: bidirectional ? `fw:${index}+${mirror}` : `fw:${index}`,
        type: "corridor",
        source: src,
        target: dst,
        sourceHandle: lane.sourceHandle,
        targetHandle: lane.targetHandle,
        label: rule.name || `${rule.protocol}/${rule.ports}`,
        data: {
          kind: "firewall",
          ruleIndex: index,
          mirrorIndex: bidirectional ? mirror : undefined,
          lane: lane.lane,
          shortLabel: rule.name ? `${rule.protocol}/${rule.ports}` : rule.action.slice(0, 3).toUpperCase(),
          obstacles: obstaclesFor(src, dst),
        },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        markerStart: bidirectional ? { type: MarkerType.ArrowClosed, color } : undefined,
        style: { stroke: color, strokeWidth: 1.5 },
      })
    })

    for (const link of trustLinks(graph.trusts, graph.domains)) {
      const from = domainAnchor.get(link.fromFqdn) ?? null
      const to = domainAnchor.get(link.toFqdn) ?? null
      if (!from || !nodeIds.has(from) || !to || !nodeIds.has(to) || from === to) continue
      const lane = takeLane(from, to)
      const color = link.relation === "parent-child" ? "#22d3ee" : "#c084fc"
      builtEdges.push({
        id: `trust:${link.sourceVmId}`,
        type: "corridor",
        source: from,
        target: to,
        sourceHandle: lane.sourceHandle,
        targetHandle: lane.targetHandle,
        label: trustLabel(link),
        data: {
          kind: "trust",
          trustSourceVmId: link.sourceVmId,
          relation: link.relation,
          lane: lane.lane,
          shortLabel: trustAcronym(link),
          obstacles: obstaclesFor(from, to),
        },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        markerStart: link.direction === "two-way" ? { type: MarkerType.ArrowClosed, color } : undefined,
        style: {
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: link.relation === "forest" ? "6 4" : undefined,
        },
      })
    }

    const selectedId = selectedEdgeIdRef.current
    setEdges(builtEdges.map((edge) => ({ ...edge, selected: edge.id === selectedId })))
  }, [
    graph,
    placeholderVlans,
    placeholderDomains,
    locked,
    goad,
    findings,
    positionFor,
    setNodes,
    setEdges,
    vmOffsets,
    layout,
    internet,
    rangeNumber,
    surface,
    rangeId,
    liveVms,
    pendingVmIds,
    kind,
    domainPins,
  ])

  const nodeKindById = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of nodes) map.set(n.id, (n.data as { kind: string }).kind)
    return map
  }, [nodes])

  const onNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    const data = node.data as unknown as BuilderNodeData
    if (data.kind === "vm") setSelection({ kind: "vm", vmId: node.id })
    else if (data.kind === "vlan") setSelection({ kind: "vlan", vlan: data.vlan })
    else if (data.kind === "domain") setSelection({ kind: "domain", fqdn: data.domain.fqdn })
    else if (data.kind === "router") setSelection({ kind: "router" })
    else setSelection({ kind: "none" })
  }, [])

  const onEdgeClick = useCallback<EdgeMouseHandler>((_, edge) => {
    const data = edge.data as BuilderEdge["data"]
    if (!data) return
    selectedEdgeIdRef.current = edge.id
    if (data.kind === "firewall" && data.ruleIndex != null) {
      setSelection({ kind: "rule", ruleIndex: data.ruleIndex, mirrorIndex: data.mirrorIndex })
    }
    else if (data.kind === "trust" && data.trustSourceVmId) setSelection({ kind: "trust", sourceVmId: data.trustSourceVmId })
    else if (data.kind === "depends" && data.depends) setSelection({ kind: "depends", edge: data.depends })
  }, [])

  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const onEdgeClickRef = useRef(onEdgeClick)
  onEdgeClickRef.current = onEdgeClick
  useEffect(() => {
    bindBuilderEdgeActivate((id) => {
      const edge = edgesRef.current.find((item) => item.id === id)
      if (!edge) return
      selectedEdgeIdRef.current = id
      setEdges((current) => current.map((item) => ({ ...item, selected: item.id === id })))
      onEdgeClickRef.current({} as never, edge)
    })
    return () => bindBuilderEdgeActivate(null)
  }, [setEdges])

  const clearMovedOffsets = useCallback((ids: string[]) => {
    setVmOffsets((prev) => {
      if (!ids.some((id) => prev[id])) return prev
      const next = { ...prev }
      for (const id of ids) delete next[id]
      return next
    })
  }, [])

  const joinVm = useCallback(
    (vmId: string, fqdn: string, vlan: number | null) => {
      const vm = graph.vms.find((item) => item.id === vmId)
      if (!vm || vm.os !== "windows") return
      const domain = graph.domains.find((item) => item.fqdn === fqdn)
      const role = domain?.primaryDcVmId && domain.primaryDcVmId !== vm.id ? "member" : "primary-dc"
      apply((current) => {
        const moved =
          vlan != null && vm.vlan !== vlan ? moveVmToVlan(current, vm.id, vlan, undefined, rangeNumber) : current
        return setDomainMembership(moved, vm.id, fqdn, role)
      })
      clearMovedOffsets([vm.id])
    },
    [apply, clearMovedOffsets, graph.domains, graph.vms, rangeNumber],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return
      const srcKind = nodeKindById.get(conn.source)
      const dstKind = nodeKindById.get(conn.target)
      const srcVm = graph.vms.find((v) => v.id === conn.source)
      const dstVm = graph.vms.find((v) => v.id === conn.target)

      // VM → domain: set membership, and move onto that domain's subnet.
      if (srcKind === "vm" && dstKind === "domain" && srcVm) {
        if (locked && isLabVm(srcVm.id, goad)) return
        if (srcVm.os !== "windows") return
        const fqdn = domainFqdnFromNodeId(conn.target)
        const vlan = domainVlanFromNodeId(conn.target) ?? domainPins[fqdn] ?? null
        joinVm(srcVm.id, fqdn, vlan)
        return
      }
      // domain → domain: forest trust. GOAD lab domains and trusts are read-only.
      if (srcKind === "domain" && dstKind === "domain") {
        if (locked) return
        const fromFqdn = domainFqdnFromNodeId(conn.source)
        const toFqdn = domainFqdnFromNodeId(conn.target)
        const res = addForestTrust(doc, fromFqdn, toFqdn, { rangeNumber })
        if (!res.ok) {
          notify({ variant: "destructive", title: "Cannot create trust", description: res.reason })
          return
        }
        apply(() => res.doc)
        return
      }
      // Firewall rule between network endpoints (vlan/endpoint/host).
      const rule = buildRuleFromConnection(srcKind, dstKind, conn, graph, nodeKindById)
      if (rule) setPendingRule(rule)
    },
    [apply, doc, domainPins, graph, joinVm, locked, goad, nodeKindById, notify, rangeNumber],
  )

  const onVmRenamed = useCallback(
    (oldId: string, newId: string) => {
      setSelection((sel) => (sel.kind === "vm" && sel.vmId === oldId ? { kind: "vm", vmId: newId } : sel))
      onLayoutRetarget(oldId, newId)
    },
    [onLayoutRetarget],
  )

  const onDomainRenamed = useCallback(
    (oldFqdn: string, newFqdn: string) => {
      if (!newFqdn || oldFqdn === newFqdn) return
      setPlaceholderDomains((prev) => {
        if (!prev.includes(oldFqdn)) return prev
        return [...new Set(prev.map((fqdn) => (fqdn === oldFqdn ? newFqdn : fqdn)))]
      })
      setSelection((sel) =>
        sel.kind === "domain" && sel.fqdn === oldFqdn ? { kind: "domain", fqdn: newFqdn } : sel,
      )
      onLayoutRetarget(domainNodeId(oldFqdn), domainNodeId(newFqdn))
    },
    [onLayoutRetarget],
  )

  const resizingIds = useRef(new Set<string>())
  const liveResize = useRef<{ id: string; width: number; height: number } | null>(null)
  const onNodesChangePersist = useCallback(
    (changes: NodeChange<BuilderNode>[]) => {
      onNodesChange(changes)
      const patch: RangeBuilderLayout = {}
      const clearSizes: string[] = []
      let live: { id: string; width: number; height: number } | null = null
      for (const change of changes) {
        if (change.type !== "dimensions") continue
        if (change.resizing === true) {
          resizingIds.current.add(change.id)
          suppressPaneClick.current = true
          if (change.dimensions) {
            live = { id: change.id, width: change.dimensions.width, height: change.dimensions.height }
          }
        }
        if (change.resizing !== false || !resizingIds.current.has(change.id) || !change.dimensions) continue
        resizingIds.current.delete(change.id)
        suppressPaneClick.current = true
        window.setTimeout(() => {
          suppressPaneClick.current = false
        }, 50)
        const node = nodes.find((entry) => entry.id === change.id)
        if (!node) continue
        const boxKind = (node.data as { kind?: string }).kind
        if (boxKind !== "vlan" && boxKind !== "domain") continue
        const { width, height } = change.dimensions
        if (!Number.isFinite(width) || !Number.isFinite(height)) continue
        const prev = layout[node.id]
        patch[node.id] = {
          x: prev?.x ?? node.position.x,
          y: prev?.y ?? node.position.y,
          width,
          height,
        }
        clearMovedOffsets(descendantIds(nodes, node.id))
        if (boxKind === "vlan") {
          for (const child of nodes) {
            if (child.parentId === node.id && child.data.kind === "domain") clearSizes.push(child.id)
          }
        }
        if (!node.parentId) continue
        const parent = nodes.find((entry) => entry.id === node.parentId)
        if (!parent) continue
        const parentPrev = layout[parent.id]
        const parentWidth = parentPrev?.width ?? px(parent.width, px(parent.style?.width, VLAN_GROUP_WIDTH))
        const parentHeight = parentPrev?.height ?? px(parent.height, px(parent.style?.height, 120))
        const needW = node.position.x + width + 12
        const needH = node.position.y + height + 12
        if (needW <= parentWidth + 1 && needH <= parentHeight + 1) continue
        patch[parent.id] = {
          x: parentPrev?.x ?? parent.position.x,
          y: parentPrev?.y ?? parent.position.y,
          width: Math.max(parentWidth, needW),
          height: Math.max(parentHeight, needH),
        }
      }
      if (live) {
        const previous = liveResize.current
        const unchanged =
          previous != null &&
          previous.id === live.id &&
          Math.abs(previous.width - live.width) < 1 &&
          Math.abs(previous.height - live.height) < 1
        if (!unchanged) {
          liveResize.current = live
          const resizedId = live.id
          setNodes((current) => reflowLiveBox(current, graph, resizedId))
        }
      } else {
        liveResize.current = null
      }
      if (clearSizes.length > 0) onLayoutClearSizes(clearSizes)
      if (Object.keys(patch).length > 0) onLayoutChange(patch)
    },
    [clearMovedOffsets, graph, layout, nodes, onLayoutChange, onLayoutClearSizes, onNodesChange, setNodes],
  )

  const onCompact = useCallback(() => {
    setVmOffsets({})
    setDomainPins({})
    onLayoutCompact(computeDefaultLayout(graph))
    window.setTimeout(() => {
      void fitView({ duration: 250, padding: 0.2 })
    }, 80)
  }, [fitView, graph, onLayoutCompact])

  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_, node) => {
      const data = node.data as BuilderNodeData
      const savePosition = () => {
        // Child positions are relative to the VLAN. Do not write them into the
        // saved layout, which still holds absolute coordinates from the flat canvas.
        if (node.parentId) {
          setVmOffsets((prev) => ({ ...prev, [node.id]: { x: node.position.x, y: node.position.y } }))
          return
        }
        onLayoutChange({ [node.id]: { x: node.position.x, y: node.position.y } })
      }
      if (kind !== "ludus" || (data.kind !== "vm" && data.kind !== "domain")) {
        savePosition()
        return
      }
      if (data.locked) {
        savePosition()
        return
      }
      const dragged = node as BuilderNode
      const live = (getNodes() as BuilderNode[]).map((entry) =>
        entry.id === dragged.id ? { ...entry, position: dragged.position, parentId: dragged.parentId } : entry,
      )
      const rect = absoluteRect(live, { ...dragged, position: dragged.position, parentId: dragged.parentId })
      const domains = live.flatMap((entry) => {
        if (entry.id === dragged.id || entry.data.kind !== "domain") return []
        const fqdn = entry.data.domain.fqdn
        return [
          {
            ...absoluteRect(live, entry),
            fqdn,
            vlan: domainVlanFromNodeId(entry.id) ?? (entry.parentId ? vlanFromNodeId(entry.parentId) : null),
          },
        ]
      })
      const vlans = live.flatMap((entry) => {
        if (entry.id === dragged.id || entry.data.kind !== "vlan") return []
        return [{ ...absoluteRect(live, entry), vlan: entry.data.vlan }]
      })
      const currentVlan =
        data.kind === "vm"
          ? data.vm.vlan
          : domainVlanFromNodeId(dragged.id) ?? (dragged.parentId ? vlanFromNodeId(dragged.parentId) : null)
      const drop = hostDropTarget({
        moving: data.kind,
        rect,
        parentId: dragged.parentId ?? null,
        currentVlan,
        domains,
        vlans,
      })
      switch (drop.kind) {
        case "stay":
          savePosition()
          return
        case "snap":
          setVmOffsets((prev) => ({ ...prev }))
          return
        case "join-domain": {
          if (data.kind !== "vm") return
          const forced = childDomainFromRoles(data.vm)
          if (forced && drop.fqdn !== forced.fqdn) {
            notify({
              title: "Stays in the child domain",
              description: `This host is in ${forced.fqdn} because it runs the child-domain role. Remove that role to join a different domain.`,
            })
            setVmOffsets((prev) => ({ ...prev }))
            return
          }
          if (data.vm.os !== "windows") {
            if (drop.vlan != null && drop.vlan !== data.vm.vlan) {
              apply((current) => moveVmToVlan(current, data.vm.id, drop.vlan!, undefined, rangeNumber))
              clearMovedOffsets([data.vm.id])
              notify({
                title: "Stayed off the domain",
                description: "Only Windows hosts join a domain. The machine moved to that subnet.",
              })
              return
            }
            notify({
              title: "Windows hosts join domains",
              description: "This machine stays on the subnet.",
            })
            setVmOffsets((prev) => ({ ...prev }))
            return
          }
          joinVm(data.vm.id, drop.fqdn, drop.vlan)
          return
        }
        case "place-vlan": {
          if (data.kind !== "vm") return
          const forced = childDomainFromRoles(data.vm)
          if (drop.unjoin && forced) {
            notify({
              title: "Stays in the child domain",
              description: `This host is in ${forced.fqdn} because it runs the child-domain role. Remove that role to unjoin it.`,
            })
            if (data.vm.vlan !== drop.vlan) {
              apply((current) => moveVmToVlan(current, data.vm.id, drop.vlan, undefined, rangeNumber))
              clearMovedOffsets([data.vm.id])
              return
            }
            setVmOffsets((prev) => ({ ...prev }))
            return
          }
          apply((current) => {
            const unjoined = drop.unjoin ? setDomainMembership(current, data.vm.id, null, "none") : current
            if (data.vm.vlan === drop.vlan) return unjoined
            return moveVmToVlan(unjoined, data.vm.id, drop.vlan, undefined, rangeNumber)
          })
          clearMovedOffsets([data.vm.id])
          return
        }
        case "move-domain": {
          if (data.kind !== "domain") return
          const fqdn = data.domain.fqdn
          const fromVlan = currentVlan
          const members = graph.vms.filter(
            (vm) => vm.domainFqdn === fqdn && (fromVlan == null || vm.vlan === fromVlan),
          )
          if (members.length === 0) {
            setDomainPins((prev) => ({ ...prev, [fqdn]: drop.toVlan }))
            clearMovedOffsets([dragged.id])
            return
          }
          apply((current) =>
            members.reduce(
              (doc, vm) => moveVmToVlan(doc, vm.id, drop.toVlan, undefined, rangeNumber),
              current,
            ),
          )
          clearMovedOffsets([dragged.id, ...members.map((vm) => vm.id)])
          return
        }
        default: {
          const unreachable: never = drop
          return unreachable
        }
      }
    },
    [apply, clearMovedOffsets, getNodes, graph.vms, joinVm, kind, notify, onLayoutChange, rangeNumber],
  )

  const deleteSelection = useCallback(() => {
    if (selection.kind === "vm") {
      if (locked && isLabVm(selection.vmId, goad)) {
        notify({ title: "Lab VM stays", description: "GOAD rewrites this machine on the next Provide." })
        return
      }
      apply((d) => removeVm(d, selection.vmId))
      setVmOffsets((prev) => {
        if (!prev[selection.vmId]) return prev
        const next = { ...prev }
        delete next[selection.vmId]
        return next
      })
      setSelection({ kind: "none" })
      return
    }
    if (selection.kind === "rule") {
      const drop = new Set([selection.ruleIndex])
      if (selection.mirrorIndex != null) drop.add(selection.mirrorIndex)
      apply((d) => setNetworkRules(d, graph.rules.filter((_, i) => !drop.has(i))))
      setSelection({ kind: "none" })
      return
    }
    if (selection.kind === "trust") {
      if (selection.sourceVmId.startsWith("child:")) {
        notify({
          title: "Parent-child trust stays",
          description: "This two-way trust comes from the child domain.",
        })
        return
      }
      if (selection.sourceVmId.startsWith("goad:")) {
        notify({
          title: "Lab trust stays",
          description: "This forest trust comes from the GOAD lab definition.",
        })
        return
      }
      if (locked) {
        notify({ title: "Lab trust stays", description: "GOAD rewrites trusts on the next Provide." })
        return
      }
      apply((d) => removeForestTrust(d, selection.sourceVmId))
      setSelection({ kind: "none" })
      return
    }
    if (selection.kind === "vlan") {
      if (placeholderVlans.includes(selection.vlan) && !graph.vlans.some((v) => v.vlan === selection.vlan)) {
        setPlaceholderVlans((prev) => prev.filter((v) => v !== selection.vlan))
        setSelection({ kind: "none" })
        return
      }
      notify({ title: "VLAN stays", description: "Move its VMs to another network before removing it." })
      return
    }
    if (selection.kind === "domain") {
      const domain = graph.domains.find((d) => d.fqdn === selection.fqdn)
      if (!domain && placeholderDomains.includes(selection.fqdn)) {
        setPlaceholderDomains((prev) => prev.filter((fqdn) => fqdn !== selection.fqdn))
        setSelection({ kind: "none" })
        return
      }
      if (domain && domain.vmIds.length === 0 && placeholderDomains.includes(selection.fqdn)) {
        setPlaceholderDomains((prev) => prev.filter((fqdn) => fqdn !== selection.fqdn))
        setSelection({ kind: "none" })
        return
      }
      notify({ title: "Domain stays", description: "Remove its members before deleting the domain." })
      return
    }
  }, [apply, goad, graph.domains, graph.rules, graph.vlans, locked, notify, placeholderDomains, placeholderVlans, selection])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return
      }
      if (selection.kind === "none") return
      event.preventDefault()
      if (selection.kind === "router" || selection.kind === "depends") return
      deleteSelection()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [deleteSelection, selection.kind])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData(PALETTE_DND_MIME)
      if (!raw) return
      let payload: PaletteDragPayload
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const hit = getIntersectingNodes({ x: pos.x, y: pos.y, width: 1, height: 1 })
      const hitVlan = hit.find((n) => (n.data as { kind: string }).kind === "vlan")
      const hitDomain = hit.find((n) => (n.data as { kind: string }).kind === "domain")
      const hitVm = hit.find((n) => (n.data as { kind: string }).kind === "vm")

      if (payload.kind === "extension") {
        goad?.onInstall(payload.name)
        return
      }
      if (payload.kind === "network") {
        const nextV = nextFreeVlan(doc, placeholderVlans)
        const taken = placeholderVlans.includes(nextV) || graph.vlans.some((v) => v.vlan === nextV)
        if (taken) return
        setPlaceholderVlans((prev) => [...prev, nextV])
        onLayoutChange({ [vlanNodeId(nextV)]: pos })
        return
      }
      if (payload.kind === "domain") {
        const fqdn = nextDomainName(graph.domains.map((d) => d.fqdn).concat(placeholderDomains))
        setPlaceholderDomains((prev) => [...prev, fqdn])
        onLayoutChange({ [domainNodeId(fqdn)]: pos })
        setSelection({ kind: "domain", fqdn })
        return
      }
      // template
      if (goad) return // new machines on a GOAD lab come from extensions
      const vlan = hitVlan ? vlanFromNodeId(hitVlan.id) : null
      const domainFqdn = hitDomain ? domainFqdnFromNodeId(hitDomain.id) : null
      const added = addVmFromTemplate(doc, payload.template, {
        vlan: vlan ?? 10,
        domainFqdn,
      })
      apply(() => added.doc)
      onLayoutChange({ [added.vmId]: hitVm ? { x: pos.x, y: pos.y + 80 } : pos })
      setSelection({ kind: "vm", vmId: added.vmId })
    },
    [apply, doc, goad, graph.domains, graph.vlans, onLayoutChange, placeholderDomains, placeholderVlans, screenToFlowPosition, getIntersectingNodes],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const undrawableRules = useMemo(
    () => graph.rules.filter((r) => vlanEndpointNodeId(r.vlan_src) == null || vlanEndpointNodeId(r.vlan_dst) == null),
    [graph.rules],
  )

  const focus = useCallback(
    (next: BuilderSelection) => {
      setSelection(next)
      const id = next.kind === "domain"
        ? nodes.find((node) => node.id === domainNodeId(next.fqdn))?.id
          ?? nodes.find((node) => node.id.startsWith(`${domainNodeId(next.fqdn)}@`))?.id
          ?? null
        : selectionNodeId(next)
      if (!id || !nodes.some((node) => node.id === id)) return
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })))
      void fitView({ nodes: [{ id }], duration: 200, padding: 0.6 })
    },
    [fitView, nodes, setNodes],
  )

  return (
    <div className="relative flex h-full min-h-0">
      <div className={`flex h-full min-h-0 w-full${presented ? "" : " pointer-events-none opacity-0"}`}>
      <RangeBuilderPalette
        surface={surface}
        kind={kind}
        templates={allTemplates}
        templatesLoading={templatesLoading}
        goad={goad}
        graph={graph}
        rangeNumber={rangeNumber}
        rangeId={rangeId}
        liveVms={liveVms}
        blueprints={blueprints}
        blueprintsLoading={blueprintsLoading}
        blueprintsError={blueprintsError}
        blueprintBusyId={blueprintBusyId}
        hasLudusSources={hasLudusSources}
        selection={selection}
        onLoadBlueprint={onLoadBlueprint}
        onFocus={focus}
      />
      <div ref={wrapperRef} className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          colorMode="dark"
          className="[&_.react-flow__node]:!bg-transparent [&_.react-flow__attribution]:!bg-transparent [&_.react-flow__attribution]:!text-muted-foreground"
          nodes={nodes}
          edges={edges}
          nodeTypes={builderNodeTypes}
          edgeTypes={builderEdgeTypes}
          onNodesChange={onNodesChangePersist}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => {
            if (suppressPaneClick.current) {
              const keep = selectionRef.current
              requestAnimationFrame(() => {
                setNodes((current) => selectNodes(current, keep))
              })
              return
            }
            selectedEdgeIdRef.current = null
            setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)))
            setSelection({ kind: "none" })
          }}
          connectionRadius={32}
          deleteKeyCode={null}
          fitView
          minZoom={0.2}
        >
          <Background />
          <Controls className="!overflow-hidden !rounded-md !border !border-border !bg-card !shadow-none [&>button]:!border-border [&>button]:!bg-card [&>button]:!fill-foreground">
            <ControlButton onClick={onCompact} title="Compact layout" aria-label="Compact layout">
              <Shrink className="!fill-none" />
            </ControlButton>
          </Controls>
          <MiniMap
            pannable
            zoomable
            bgColor="hsl(222 47% 9%)"
            maskColor="hsl(222 47% 6% / 0.65)"
            nodeColor="hsl(215 16% 40%)"
            nodeStrokeColor="hsl(215 20% 65%)"
            className="!bg-card"
          />
          <Panel position="top-left" className="rounded-md border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-4 rounded-sm border-2 border-amber-500/80" />
              subnet
              <span className="inline-block h-2 w-4 rounded-sm border-2 border-cyan-500/80" />
              domain
              <span className="inline-block w-4 border-t-2 border-dashed border-purple-400" />
              forest trust
              <span className="inline-block w-4 border-t-2 border-cyan-400" />
              parent-child
            </span>
          </Panel>
          {internet != null && (
            <Panel
              position="top-center"
              className={
                internet === "on"
                  ? "rounded-md border border-status-success/50 bg-status-success/15 px-3 py-1.5 text-xs font-medium text-status-success"
                  : "rounded-md border border-status-warning/60 bg-status-warning/15 px-3 py-1.5 text-xs font-medium text-status-warning"
              }
            >
              {internet === "testing"
                ? "Testing mode — no internet. VMs are snapshotted and internet access is blocked."
                : internet === "firewall"
                  ? "Firewall blocks internet. external_default is REJECT or DROP."
                  : "Internet on"}
            </Panel>
          )}
          {undrawableRules.length > 0 && (
            <Panel position="bottom-left" className="rounded-md border border-border bg-card/90 p-2 text-xs">
              <p className="mb-1 font-semibold">Rules targeting all/missing VLANs</p>
              <div className="space-y-0.5">
                {graph.rules.map((r, i) =>
                  vlanEndpointNodeId(r.vlan_src) == null || vlanEndpointNodeId(r.vlan_dst) == null ? (
                    <button
                      key={`${r.name}-${i}`}
                      className="block w-full truncate text-left hover:text-primary"
                      onClick={() => setSelection({ kind: "rule", ruleIndex: i })}
                    >
                      {r.name || `${r.vlan_src}→${r.vlan_dst}`}
                    </button>
                  ) : null,
                )}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
      </div>
      {!presented && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card" role="status" aria-live="polite">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading range</p>
        </div>
      )}
      {selection.kind !== "none" && (
        <RangeBuilderInspector
          selection={selection}
          graph={graph}
          doc={doc}
          apply={apply}
          builtTemplates={builtTemplates}
          locked={locked && selectionIsLabOwned(selection, graph, goad)}
          rangeNumber={rangeNumber}
          onClose={() => setSelection({ kind: "none" })}
          onVmRenamed={onVmRenamed}
          onDomainRenamed={onDomainRenamed}
          routerDetails={routerDetails}
          rangeId={rangeId}
          findings={findings}
        />
      )}
      <FirewallRuleDialog
        rule={pendingRule}
        vlans={graph.vlans.map((vlan) => vlan.vlan)}
        rangeNumber={rangeNumber}
        onOpenChange={(open) => {
          if (!open) setPendingRule(null)
        }}
        onSave={(rule) => {
          const next = [...graph.rules, rule]
          apply((current) => setNetworkRules(current, next))
          setSelection({ kind: "rule", ruleIndex: next.length - 1 })
          setPendingRule(null)
        }}
      />
    </div>
  )
}

export function RangeBuilderCanvas(props: RangeBuilderCanvasProps) {
  return (
    <ReactFlowProvider>
      <RangeBuilderFlow {...props} />
    </ReactFlowProvider>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function vlanFromNodeId(id: string): number | null {
  const m = id.match(/^vlan:(\d+)$/)
  return m ? Number(m[1]) : null
}
function isLabVm(_vmId: string, goad: GoadBuilderContext | null): boolean {
  // On a GOAD-mapped range every VM in range-config is lab-owned until an
  // extension adds more; lock them all.
  return goad != null
}

function selectionIsLabOwned(
  selection: BuilderSelection,
  _graph: BuilderGraph,
  goad: GoadBuilderContext | null,
): boolean {
  if (!goad) return false
  return (
    selection.kind === "vm" ||
    selection.kind === "domain" ||
    selection.kind === "trust" ||
    selection.kind === "vlan"
  )
}

function nextDomainName(existing: string[]): string {
  const taken = new Set(existing)
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? "lab.local" : `lab${i}.local`
    if (!taken.has(name)) return name
  }
  return `lab${Date.now()}.local`
}

function buildRuleFromConnection(
  srcKind: string | undefined,
  dstKind: string | undefined,
  conn: Connection,
  graph: BuilderGraph,
  nodeKindById: Map<string, string>,
): NetworkRule | null {
  const endpointToVlan = (id: string, kind: string | undefined): { vlan: VlanValue; octet?: string } | null => {
    if (kind === "endpoint") {
      return { vlan: id.endsWith("wireguard") ? "wireguard" : "public" }
    }
    if (kind === "vlan") {
      const v = vlanFromNodeId(id)
      return v != null ? { vlan: v } : null
    }
    if (kind === "vm") {
      const vm = graph.vms.find((x) => x.id === id)
      return vm ? { vlan: vm.vlan, octet: String(vm.ipLastOctet) } : null
    }
    return null
  }
  const validSrc = srcKind === "vlan" || srcKind === "endpoint" || srcKind === "vm"
  const validDst = dstKind === "vlan" || dstKind === "endpoint" || dstKind === "vm"
  if (!validSrc || !validDst) return null
  const src = endpointToVlan(conn.source!, nodeKindById.get(conn.source!))
  const dst = endpointToVlan(conn.target!, nodeKindById.get(conn.target!))
  if (!src || !dst) return null
  const rule: NetworkRule = {
    name: `${labelFor(src.vlan)} to ${labelFor(dst.vlan)}`,
    vlan_src: src.vlan,
    vlan_dst: dst.vlan,
    protocol: "all",
    ports: "all",
    action: "ACCEPT",
  }
  if (src.octet) rule.ip_last_octet_src = src.octet
  if (dst.octet) rule.ip_last_octet_dst = dst.octet
  return rule
}

function labelFor(v: VlanValue): string {
  return typeof v === "number" ? `VLAN ${v}` : v
}
