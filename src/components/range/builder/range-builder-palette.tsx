"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Search,
  Monitor,
  Server,
  Network,
  Building2,
  Puzzle,
  PackageX,
  BookOpen,
  Download,
  Trash2,
  CheckCircle2,
  Loader2,
  Router,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/core/utils"
import type { GoadExtensionDef } from "@/lib/core/types"
import type { BuilderGraph } from "@/lib/range/range-builder-document"
import {
  PALETTE_DND_MIME,
  groupTemplates,
  matchLiveVm,
  vlanCidr,
  vmAddress,
  type BlueprintPaletteItem,
  type BuilderKind,
  type BuilderSelection,
  type BuilderSurface,
  type LiveVmRow,
  type PaletteDragPayload,
  type TemplateRow,
  type GoadBuilderContext,
} from "./builder-types"

interface PaletteProps {
  surface: BuilderSurface
  kind: BuilderKind
  templates: TemplateRow[]
  templatesLoading: boolean
  goad: GoadBuilderContext | null
  graph: BuilderGraph
  rangeNumber: number | null
  rangeId: string
  liveVms: LiveVmRow[]
  blueprints: BlueprintPaletteItem[]
  blueprintsLoading: boolean
  blueprintsError: boolean
  blueprintBusyId: string | null
  hasLudusSources: boolean
  selection: BuilderSelection
  onLoadBlueprint: (blueprint: BlueprintPaletteItem) => void
  onFocus: (selection: BuilderSelection) => void
}

function setDrag(e: React.DragEvent, payload: PaletteDragPayload) {
  e.dataTransfer.setData(PALETTE_DND_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = "copy"
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

export function RangeBuilderPalette({
  surface,
  kind,
  templates,
  templatesLoading,
  goad,
  graph,
  rangeNumber,
  rangeId,
  liveVms,
  blueprints,
  blueprintsLoading,
  blueprintsError,
  blueprintBusyId,
  hasLudusSources,
  selection,
  onLoadBlueprint,
  onFocus,
}: PaletteProps) {
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border bg-background">
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold">{surface === "viewer" ? "Range Viewer" : "Build"}</h2>
        <p className="text-[11px] text-muted-foreground">
          {surface === "viewer"
            ? "Present state. Select a machine to change it, then deploy."
            : kind === "goad"
              ? goad
                ? "Drag a GOAD extension onto the canvas. It stays pending until deploy."
                : "Deploy a GOAD lab into this range, or load a blueprint first."
              : "Load a blueprint from a Ludus source, or drag a template onto the canvas."}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {surface === "viewer" && (
          <PresentState
            graph={graph}
            rangeNumber={rangeNumber}
            rangeId={rangeId}
            liveVms={liveVms}
            selection={selection}
            onFocus={onFocus}
          />
        )}

        {goad == null && (
          <BlueprintList
            blueprints={blueprints}
            loading={blueprintsLoading}
            error={blueprintsError}
            busyId={blueprintBusyId}
            hasLudusSources={hasLudusSources}
            onLoad={onLoadBlueprint}
          />
        )}

        {kind === "ludus" && (
          <>
            <TopologySection />
            <TemplateSection templates={templates} templatesLoading={templatesLoading} />
          </>
        )}

        {kind === "goad" && goad && <ExtensionSection goad={goad} />}
        {kind === "goad" && !goad && <GoadDeployCard rangeId={rangeId} />}
      </div>
    </aside>
  )
}

function PresentState({
  graph,
  rangeNumber,
  rangeId,
  liveVms,
  selection,
  onFocus,
}: {
  graph: BuilderGraph
  rangeNumber: number | null
  rangeId: string
  liveVms: LiveVmRow[]
  selection: BuilderSelection
  onFocus: (selection: BuilderSelection) => void
}) {
  const machines = useMemo(
    () => [...graph.vms].sort((a, b) => a.vlan - b.vlan || a.ipLastOctet - b.ipLastOctet || a.id.localeCompare(b.id)),
    [graph.vms],
  )

  return (
    <div className="space-y-3 border-b border-border p-3">
      <div>
        <SectionLabel>Networks</SectionLabel>
        <div className="space-y-1">
          <FocusRow
            icon={Router}
            label="Router"
            detail={graph.router.template || "Ludus router"}
            active={selection.kind === "router"}
            onClick={() => onFocus({ kind: "router" })}
          />
          {graph.vlans.map((vlan) => (
            <FocusRow
              key={vlan.vlan}
              icon={Network}
              label={`VLAN ${vlan.vlan}`}
              detail={vlanCidr(vlan.vlan, rangeNumber) ?? `${vlan.vmIds.length} VMs`}
              active={selection.kind === "vlan" && selection.vlan === vlan.vlan}
              onClick={() => onFocus({ kind: "vlan", vlan: vlan.vlan })}
            />
          ))}
          {graph.vlans.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No subnets in this configuration.</p>
          )}
        </div>
      </div>

      {graph.domains.length > 0 && (
        <div>
          <SectionLabel>Domains</SectionLabel>
          <div className="space-y-1">
            {graph.domains.map((domain) => (
              <FocusRow
                key={domain.fqdn}
                icon={Building2}
                label={domain.fqdn}
                detail={`${domain.vmIds.length} member${domain.vmIds.length === 1 ? "" : "s"}`}
                active={selection.kind === "domain" && selection.fqdn === domain.fqdn}
                onClick={() => onFocus({ kind: "domain", fqdn: domain.fqdn })}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Machines</SectionLabel>
        <div className="space-y-1">
          {machines.map((vm) => {
            const live = matchLiveVm(vm, rangeId, liveVms)
            const planned = vmAddress(vm, rangeNumber)
            const label = vm.hostname.replace(/\{\{\s*range_id\s*\}\}-?/g, "") || vm.vmName
            return (
              <FocusRow
                key={vm.id}
                icon={vm.os === "windows" ? Monitor : Server}
                label={label}
                detail={live?.ip || planned}
                presence={live ? (live.poweredOn ? "on" : "off") : "missing"}
                active={selection.kind === "vm" && selection.vmId === vm.id}
                onClick={() => onFocus({ kind: "vm", vmId: vm.id })}
              />
            )
          })}
          {machines.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No machines in this configuration.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function FocusRow({
  icon: Icon,
  label,
  detail,
  active,
  presence,
  onClick,
}: {
  icon: typeof Router
  label: string
  detail: string
  active: boolean
  presence?: "on" | "off" | "missing"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left",
        active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{detail}</span>
      </span>
      {presence === "on" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" title="Powered on" />}
      {presence === "off" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" title="Powered off" />}
      {presence === "missing" && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground" title="Not deployed" />
      )}
    </button>
  )
}

function BlueprintList({
  blueprints,
  loading,
  error,
  busyId,
  hasLudusSources,
  onLoad,
}: {
  blueprints: BlueprintPaletteItem[]
  loading: boolean
  error: boolean
  busyId: string | null
  hasLudusSources: boolean
  onLoad: (blueprint: BlueprintPaletteItem) => void
}) {
  const groups = new Map<string, BlueprintPaletteItem[]>()
  for (const blueprint of blueprints) {
    const label = blueprint.sourceLabel || "On this host"
    const rows = groups.get(label) ?? []
    rows.push(blueprint)
    groups.set(label, rows)
  }
  const grouped = [...groups.entries()]
  return (
    <div className="border-b border-border p-3">
      <SectionLabel>Blueprints</SectionLabel>
      {loading && (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading blueprints…
        </div>
      )}
      {error && !loading && (
        <p className="text-xs text-muted-foreground">Could not load blueprints.</p>
      )}
      {!loading && !error && blueprints.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {hasLudusSources ? "No blueprints in the loaded Ludus sources." : "No Ludus sources are loaded."}
        </p>
      )}
      <div className="space-y-2">
        {grouped.map(([label, rows]) => (
          <div key={label} className="space-y-1.5">
            {(label !== "On this host" || grouped.length > 1) && (
              <p className="truncate text-[10px] font-medium text-muted-foreground">{label}</p>
            )}
            {rows.map((blueprint) => {
              const title = blueprint.name || blueprint.id
              const detail =
                blueprint.description || (blueprint.name && blueprint.name !== blueprint.id ? blueprint.id : "")
              const busy = busyId === blueprint.id
              return (
                <button
                  key={blueprint.id}
                  type="button"
                  disabled={busyId != null}
                  onClick={() => onLoad(blueprint)}
                  className={cn(
                    "w-full rounded-md border px-2.5 py-2 text-left",
                    busyId != null
                      ? "cursor-not-allowed border-dashed border-border opacity-60"
                      : "border-border bg-card hover:border-primary/50",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                    <span className="block truncate text-sm font-medium">{title}</span>
                  </span>
                  {detail && (
                    <span className="mt-0.5 line-clamp-2 block text-[10px] text-muted-foreground">{detail}</span>
                  )}
                  {blueprint.sourceId && !blueprint.installedId && (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">Installs from this source</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function TopologySection() {
  return (
    <div className="space-y-2 border-b border-border p-3">
      <SectionLabel>Topology</SectionLabel>
      <PaletteTile
        icon={Network}
        label="Network (VLAN)"
        hint="next free VLAN"
        onDragStart={(e) => setDrag(e, { kind: "network" })}
      />
      <PaletteTile
        icon={Building2}
        label="Domain"
        hint="AD domain"
        onDragStart={(e) => setDrag(e, { kind: "domain" })}
      />
    </div>
  )
}

function TemplateSection({
  templates,
  templatesLoading,
}: {
  templates: TemplateRow[]
  templatesLoading: boolean
}) {
  const [query, setQuery] = useState("")
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates
    return groupTemplates(rows)
  }, [templates, query])

  return (
    <div className="p-3">
      <SectionLabel>Templates</SectionLabel>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-7 text-xs"
          placeholder="Filter templates"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {templatesLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <div key={group.os} className="space-y-1.5">
              <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              {group.rows.map((template) => (
                <TemplateTile key={template.name} template={template} draggable={template.built} />
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="py-3 text-xs text-muted-foreground">No templates match.</p>
          )}
        </div>
      )}
    </div>
  )
}

function GoadDeployCard({ rangeId }: { rangeId: string }) {
  return (
    <div className="border-b border-border p-3">
      <SectionLabel>GOAD</SectionLabel>
      <p className="text-xs text-muted-foreground">
        A GOAD lab supplies the machines, domains, and trusts, and replaces what is already in this range.
        Firewall rules stay editable here after Provide.
      </p>
      <Button asChild className="mt-2 w-full" size="sm">
        <Link href={`/goad/new?rangeId=${encodeURIComponent(rangeId)}`}>Deploy as GOAD</Link>
      </Button>
    </div>
  )
}

function PaletteTile({
  icon: Icon,
  label,
  hint,
  onDragStart,
}: {
  icon: typeof Network
  label: string
  hint: string
  onDragStart: (e: React.DragEvent) => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm shadow-sm active:cursor-grabbing hover:border-primary/50"
    >
      <Icon className="h-4 w-4 text-primary" />
      <span className="flex-1">{label}</span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </div>
  )
}

function TemplateTile({ template, draggable }: { template: TemplateRow; draggable: boolean }) {
  const Icon = template.os === "windows" ? Monitor : Server
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => draggable && setDrag(e, { kind: "template", template: template.name })}
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm",
        draggable
          ? "cursor-grab border-border bg-card active:cursor-grabbing hover:border-primary/50"
          : "cursor-not-allowed border-dashed border-border bg-muted/30 opacity-70",
      )}
      title={draggable ? "Drag onto the canvas or a VLAN" : "Build this template first"}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="truncate font-mono">{template.name}</span>
      {!template.built && <PackageX className="ml-auto h-3 w-3 flex-shrink-0 text-status-error" />}
    </div>
  )
}

function ExtensionSection({ goad }: { goad: GoadBuilderContext }) {
  return (
    <div className="border-t border-border p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase text-muted-foreground">
          GOAD extensions
        </span>
      </div>
      {goad.labName && (
        <p className="mb-2 text-[10px] text-muted-foreground">
          Lab <code className="text-primary">{goad.labName}</code>. Drag an extension onto the canvas.
          It stays pending until you deploy.
        </p>
      )}

      {goad.extensions.length === 0 && (
        <p className="text-xs text-muted-foreground">No compatible extensions on this GOAD host.</p>
      )}

      <div className="space-y-1.5">
        {goad.extensions.map((ext) => (
          <ExtensionTile key={ext.name} ext={ext} goad={goad} />
        ))}
      </div>
    </div>
  )
}

function ExtensionTile({ ext, goad }: { ext: GoadExtensionDef; goad: GoadBuilderContext }) {
  const installed = goad.installed.has(ext.name)
  const staged = goad.pending.has(ext.name)
  const state = goad.extensionReady(ext)
  const draggable = !installed && !staged && !goad.isRunning

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => draggable && setDrag(e, { kind: "extension", name: ext.name })}
      className={cn(
        "rounded-md border px-2.5 py-2 text-xs shadow-sm",
        installed
          ? "border-status-success/40 bg-green-500/5"
          : draggable
            ? "cursor-grab border-border bg-card active:cursor-grabbing hover:border-primary/50"
            : "border-dashed border-border bg-muted/30",
      )}
    >
      <div className="flex items-center gap-1.5">
        {installed && <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-status-success" />}
        <code className="truncate font-mono text-primary">{ext.name}</code>
        {staged && (
          <span className="rounded bg-status-warning/15 px-1 text-[9px] font-semibold uppercase text-status-warning">
            Pending
          </span>
        )}
        {ext.machines.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">+{ext.machines.length} VM</span>
        )}
      </div>
      {ext.description && <p className="mt-0.5 text-[10px] text-muted-foreground">{ext.description}</p>}

      {!installed && state.missingTemplates.length > 0 && (
        <Badge variant="destructive" className="mt-1 text-[9px] gap-1">
          <PackageX className="h-2.5 w-2.5" /> templates
        </Badge>
      )}
      {!installed && state.missingTemplates.length === 0 && state.missingAnsible.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1 h-7 w-full text-[10px]"
          onClick={() => goad.onInstallDeps(ext)}
        >
          <BookOpen className="h-3 w-3" /> Install {state.missingAnsible.length} role(s)
        </Button>
      )}

      <div className="mt-1.5 flex gap-1.5">
        {installed ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-[10px] text-destructive"
            disabled={goad.isRunning}
            onClick={() => goad.onRemove(ext.name)}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        ) : staged ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-[10px]"
            onClick={() => goad.onUnstage(ext.name)}
          >
            Remove from canvas
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-[10px]"
            disabled={goad.isRunning}
            onClick={() => goad.onInstall(ext.name)}
          >
            <Download className="h-3 w-3" /> Install
          </Button>
        )}
      </div>
    </div>
  )
}
