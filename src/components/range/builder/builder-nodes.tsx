"use client"

import { memo, type ComponentProps } from "react"
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react"
import {
  Server,
  Monitor,
  Network,
  Globe,
  WifiOff,
  ShieldCheck,
  Building2,
  Lock,
  AlertTriangle,
  Router,
  KeyRound,
} from "lucide-react"
import { cn } from "@/lib/core/utils"
import {
  DOMAIN_BOX_WIDTH,
  VLAN_GROUP_WIDTH,
  domainGroupHeight,
  type VmNodeData,
  type VlanNodeData,
  type DomainNodeData,
  type RouterNodeData,
  type EndpointNodeData,
} from "./builder-types"

const HANDLE_CLASS =
  "!z-20 !flex !h-4 !w-4 !cursor-crosshair !items-center !justify-center !border-0 !bg-transparent"

/** The visible dot stays small. The handle around it is the click target. */
function ConnectHandle(props: ComponentProps<typeof Handle>) {
  return (
    <Handle {...props} className={HANDLE_CLASS} style={props.style}>
      <span className="pointer-events-none h-2 w-2 rounded-full border border-border bg-muted-foreground/80" />
    </Handle>
  )
}
const RESIZE_LINE = "!border-sky-400/80"
const RESIZE_HANDLE = "!h-2 !w-2 !rounded-sm !border-0 !bg-sky-400"

/** One height on each side so a facing pair is a single segment, not a step. */
const SIDE_HANDLE = { top: "50%" }

/** Left, right, top, and bottom. Each face has a source and a target so either end of a line can land there. */
function BoxHandles() {
  return (
    <>
      <ConnectHandle id="in" type="target" position={Position.Left} style={SIDE_HANDLE} />
      <ConnectHandle id="out-left" type="source" position={Position.Left} style={SIDE_HANDLE} />
      <ConnectHandle id="in-right" type="target" position={Position.Right} style={SIDE_HANDLE} />
      <ConnectHandle id="out" type="source" position={Position.Right} style={SIDE_HANDLE} />
      <ConnectHandle id="in-top" type="target" position={Position.Top} />
      <ConnectHandle id="out-top" type="source" position={Position.Top} />
      <ConnectHandle id="in-bottom" type="target" position={Position.Bottom} />
      <ConnectHandle id="out-bottom" type="source" position={Position.Bottom} />
    </>
  )
}

const SUBNET_TONES = [
  "border-amber-500/80",
  "border-sky-500/80",
  "border-violet-500/80",
  "border-emerald-500/80",
] as const

function toneClass(tone: number): string {
  return SUBNET_TONES[Math.abs(tone) % SUBNET_TONES.length] ?? SUBNET_TONES[0]
}

function ErrorMark({ show, messages }: { show: boolean; messages?: string[] }) {
  if (!show && (messages == null || messages.length === 0)) return null
  const title = messages && messages.length > 0 ? messages.join("\n") : "Has errors"
  return (
    <span title={title} className="inline-flex">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-error" aria-label={title} />
    </span>
  )
}

function roleLabel(role: VmNodeData["vm"]["domainRole"]): string | null {
  switch (role) {
    case "primary-dc":
    case "alt-dc":
      return "DC"
    case "member":
      return "Member"
    case "none":
      return null
    default: {
      const unreachable: never = role
      return unreachable
    }
  }
}

export const VmNode = memo(function VmNode({ data, selected }: NodeProps) {
  const d = data as unknown as VmNodeData
  const vm = d.vm
  const Icon = vm.os === "windows" ? Monitor : Server
  const label = vm.hostname.replace(/\{\{\s*range_id\s*\}\}-?/g, "") || vm.vmName
  const role = roleLabel(vm.domainRole)
  const errorTitle = d.messages && d.messages.length > 0 ? d.messages.join("\n") : undefined
  return (
    <div
      title={errorTitle}
      style={{ width: d.cardWidth ?? 220, minHeight: d.cardHeight }}
      className={cn(
        "rounded-md border border-l-4 bg-card px-2.5 py-1.5 shadow-sm transition-colors",
        vm.os === "windows" ? "border-l-sky-400" : "border-l-emerald-400",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
        d.pending && "border-dashed border-status-warning",
        d.hasError && "border-status-error",
      )}
    >
      <ConnectHandle type="target" position={Position.Left} className={HANDLE_CLASS} />
      <ConnectHandle type="source" position={Position.Right} className={HANDLE_CLASS} />
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{label}</span>
        {d.locked && <Lock className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label="Lab-owned" />}
        {d.pending && (
          <span className="rounded bg-status-warning/15 px-1 text-[9px] font-semibold uppercase text-status-warning">
            Pending
          </span>
        )}
        <ErrorMark show={d.hasError} messages={d.messages} />
        {d.presence === "on" && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" title="Powered on" />
        )}
        {d.presence === "off" && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" title="Powered off" />
        )}
        {d.presence === "missing" && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground" title="Not deployed" />
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{d.address}</span>
        {role && (
          <span className="rounded bg-sky-500/15 px-1 font-semibold uppercase text-[9px] text-sky-300">{role}</span>
        )}
        {d.keepsInternet && (
          <span className="rounded bg-status-success/15 px-1 text-status-success">keeps internet</span>
        )}
      </div>
    </div>
  )
})

function BoxBadge({ children }: { children: string }) {
  return (
    <span className="ml-auto shrink-0 rounded bg-foreground/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}

export const VlanNode = memo(function VlanNode({ data, selected }: NodeProps) {
  const d = data as unknown as VlanNodeData
  const countLabel = d.shared
    ? "shared"
    : `${d.count} VM${d.count === 1 ? "" : "s"}`
  return (
    <div
      className={cn(
        "relative h-full w-full rounded-lg border-2 bg-card/25",
        toneClass(d.tone),
        selected && "ring-1 ring-primary",
        d.shared && "border-dashed",
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={VLAN_GROUP_WIDTH}
        minHeight={d.boxHeight}
        lineClassName={RESIZE_LINE}
        handleClassName={RESIZE_HANDLE}
      />
      <BoxHandles />
      <div className="relative border-b border-current/15 bg-card px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Network className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-xs font-semibold">VLAN {d.vlan}</span>
          <BoxBadge>Subnet</BoxBadge>
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {d.subnet ? `${d.subnet} · ${countLabel}` : countLabel}
        </div>
      </div>
      {d.unjoinedAt != null && (
        <div
          className="absolute text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
          style={{
            top: d.unjoinedAt - 16,
            left: `min(${Math.round(d.unjoinedLabelX ?? 12)}px, calc(100% - 4.75rem))`,
          }}
        >
          Not joined
        </div>
      )}
    </div>
  )
})

export const DomainNode = memo(function DomainNode({ data, selected }: NodeProps) {
  const d = data as unknown as DomainNodeData
  const members = `${d.count} member${d.count === 1 ? "" : "s"}`
  const errorTitle = d.messages && d.messages.length > 0 ? d.messages.join("\n") : undefined
  if (d.grouped) {
    return (
      <div
        title={errorTitle}
        className={cn(
          "h-full w-full rounded-lg border-2 border-cyan-500/80 bg-card",
          selected && "ring-1 ring-primary",
          d.hasError && "border-status-error",
        )}
      >
        <NodeResizer
          isVisible={selected}
          minWidth={DOMAIN_BOX_WIDTH}
          minHeight={domainGroupHeight(d.count)}
          lineClassName={RESIZE_LINE}
          handleClassName={RESIZE_HANDLE}
        />
        <BoxHandles />
        <div className="border-b border-cyan-500/20 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
            <span className="min-w-0 truncate text-xs font-semibold">{d.domain.fqdn}</span>
            {d.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Lab-owned" />}
            <ErrorMark show={d.hasError} messages={d.messages} />
            <BoxBadge>Domain</BoxBadge>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {members}
            {d.domain.childOfFqdn ? ` · child of ${d.domain.childOfFqdn}` : ""}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div
      title={errorTitle}
      className={cn(
        "h-full w-full rounded-lg border-2 border-cyan-500/70 bg-card px-3 py-2 shadow-sm",
        selected && "ring-1 ring-primary",
        d.hasError && "border-status-error",
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={76}
        lineClassName={RESIZE_LINE}
        handleClassName={RESIZE_HANDLE}
      />
      <BoxHandles />
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-cyan-300" />
        <span className="min-w-0 truncate text-sm font-semibold">{d.domain.fqdn}</span>
        {d.locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Lab-owned" />}
        <ErrorMark show={d.hasError} messages={d.messages} />
        <BoxBadge>Domain</BoxBadge>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{members}</span>
        {d.domain.childOfFqdn && <span className="truncate font-mono">child of {d.domain.childOfFqdn}</span>}
      </div>
    </div>
  )
})

export const RouterNode = memo(function RouterNode({ data, selected }: NodeProps) {
  const d = data as unknown as RouterNodeData
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 shadow-sm",
        "bg-card",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <ConnectHandle id="out" type="source" position={Position.Right} />
      <ConnectHandle id="down" type="source" position={Position.Bottom} />
      <Router className="h-4 w-4 text-status-warning" />
      <span className="text-sm font-medium">Router</span>
      {d.router.template && <span className="text-[11px] text-muted-foreground font-mono">pinned</span>}
    </div>
  )
})

export const EndpointNode = memo(function EndpointNode({ data, selected }: NodeProps) {
  const d = data as unknown as EndpointNodeData
  const blocked = d.endpoint === "public" && d.internet && d.internet !== "on"
  const Icon = d.endpoint === "wireguard" ? KeyRound : blocked ? WifiOff : Globe
  const label =
    d.endpoint === "wireguard"
      ? "WireGuard"
      : d.internet === "testing"
        ? "No internet"
        : d.internet === "firewall"
          ? "Internet blocked"
          : "Internet"
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1 shadow-sm bg-card",
        blocked
          ? "border-status-error bg-status-error/10"
          : selected
            ? "border-primary ring-1 ring-primary"
            : "border-border",
      )}
    >
      <BoxHandles />
      <Icon className={cn("h-3.5 w-3.5", blocked ? "text-status-error" : "text-muted-foreground")} />
      <span className={cn("text-xs font-medium", blocked && "text-status-error")}>{label}</span>
    </div>
  )
})

export function CanvasLegendIcon() {
  return <ShieldCheck className="h-4 w-4" />
}

export const builderNodeTypes = {
  vm: VmNode,
  vlan: VlanNode,
  domain: DomainNode,
  router: RouterNode,
  endpoint: EndpointNode,
}
