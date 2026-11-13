"use client"

import { useEffect, useMemo, useState } from "react"
import yaml from "js-yaml"
import { Trash2, Plus, X, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/core/utils"
import {
  type RangeDocument,
  type BuilderGraph,
  type BuilderVm,
  type BuilderRoleEntry,
  type DomainRole,
  type Finding,
  updateVmRaw,
  removeVm,
  renumberVlan,
  setDomainMembership,
  renameDomain,
  setRangeDefaults,
  setRouter,
  setVmRoles,
  setVmRoleVars,
  removeForestTrust,
  setNetworkRules,
  vmTestingFlag,
} from "@/lib/range/range-builder-document"
import {
  LUDUS_WINDOWS_UTILS_ROLES,
  findLudusRoleDef,
  roleShortName,
  type RoleField,
  FOREST_TRUST_ROLE,
} from "@/lib/range/range-builder-ludus-roles"
import {
  displayHostAddress,
  isHostAddress,
  normalizeIpLastOctet,
  type NetworkRule,
  type Protocol,
  type RuleAction,
} from "@/lib/range/network-rules"
import {
  expandRangeId,
  restoreRangeId,
  type BuilderSelection,
  type TemplateRow,
  type DependsSelectionEdge,
  type RouterDetails,
} from "./builder-types"
import { trustLabel, trustLinks } from "./builder-routing"

interface InspectorProps {
  selection: BuilderSelection
  graph: BuilderGraph
  doc: RangeDocument
  apply: (fn: (doc: RangeDocument) => RangeDocument) => void
  builtTemplates: TemplateRow[]
  locked: boolean
  rangeNumber: number | null
  onClose: () => void
  onVmRenamed: (oldId: string, newId: string) => void
  onDomainRenamed: (oldFqdn: string, newFqdn: string) => void
  routerDetails: RouterDetails
  rangeId: string
  findings: Finding[]
}

const FUNCTIONAL_LEVELS = [
  "Win2003",
  "Win2008",
  "Win2008R2",
  "Win2012",
  "Win2012R2",
  "WinThreshold",
  "Win2025",
]

export function RangeBuilderInspector(props: InspectorProps) {
  const { selection, onClose } = props
  return (
    <aside className="flex h-full w-[340px] flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{titleFor(selection)}</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <InspectorBody {...props} />
      </div>
    </aside>
  )
}

function titleFor(selection: BuilderSelection): string {
  switch (selection.kind) {
    case "vm":
      return "Virtual machine"
    case "vlan":
      return "Network (VLAN)"
    case "domain":
      return "Domain"
    case "router":
      return "Router"
    case "rule":
      return "Firewall rule"
    case "trust":
      return "Trust"
    case "depends":
      return "Role dependency"
    default:
      return "Range builder"
  }
}

function InspectorBody(props: InspectorProps) {
  const { selection, graph } = props
  switch (selection.kind) {
    case "vm": {
      const vm = graph.vms.find((v) => v.id === selection.vmId)
      if (!vm) return <Empty />
      return <VmInspector {...props} vm={vm} />
    }
    case "vlan":
      return <VlanInspector {...props} vlan={selection.vlan} />
    case "domain":
      return <DomainInspector {...props} fqdn={selection.fqdn} />
    case "router":
      return <RouterInspector {...props} />
    case "rule":
      return <RuleInspector {...props} ruleIndex={selection.ruleIndex} mirrorIndex={selection.mirrorIndex} />
    case "trust":
      return <TrustInspector {...props} sourceVmId={selection.sourceVmId} />
    case "depends":
      return <DependsInspector {...props} edge={selection.edge} />
    default:
      return <Empty />
  }
}

function Empty() {
  return (
    <p className="text-sm text-muted-foreground">
      Select a node or edge on the canvas to edit it.
    </p>
  )
}

function FindingNotes({ findings }: { findings: Finding[] }) {
  const errors = findings.filter((finding) => finding.level === "error")
  const warnings = findings.filter((finding) => finding.level === "warning")
  if (errors.length === 0 && warnings.length === 0) return null
  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {errors.map((finding, index) => (
                <li key={`error-${index}`}>{finding.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {warnings.map((finding, index) => (
                <li key={`warning-${index}`}>{finding.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function LockedBanner() {
  return (
    <Alert className="mb-3">
      <Info className="h-4 w-4" />
      <AlertDescription className="text-xs">
        This range is a GOAD lab. VM, domain, trust, and VLAN fields are read-only — the next Provide
        rewrites them from GOAD templates. Firewall rules stay editable.
      </AlertDescription>
    </Alert>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

// ── VM ────────────────────────────────────────────────────────────────────────

function VmInspector({
  vm,
  graph,
  apply,
  builtTemplates,
  locked,
  onClose,
  onVmRenamed,
  rangeId,
  findings,
}: InspectorProps & { vm: BuilderVm }) {
  const disabled = locked
  const update = (patch: Record<string, unknown>) => apply((d) => updateVmRaw(d, vm.id, patch))
  const [nameDraft, setNameDraft] = useState(() => expandRangeId(vm.vmName, rangeId))
  const [hostDraft, setHostDraft] = useState(() => expandRangeId(vm.hostname, rangeId))
  const [vlanDraft, setVlanDraft] = useState(String(vm.vlan))
  const [octetDraft, setOctetDraft] = useState(String(vm.ipLastOctet))
  useEffect(() => {
    setNameDraft(expandRangeId(vm.vmName, rangeId))
    setHostDraft(expandRangeId(vm.hostname, rangeId))
  }, [rangeId, vm.hostname, vm.id, vm.vmName])
  useEffect(() => {
    setVlanDraft(String(vm.vlan))
    setOctetDraft(String(vm.ipLastOctet))
  }, [vm.id, vm.vlan, vm.ipLastOctet])

  const hostFindings = findings.filter((finding) => finding.nodeId === vm.id)
  return (
    <div className="space-y-3">
      {locked && <LockedBanner />}
      <FindingNotes findings={hostFindings} />
      <Field label="Template">
        <Select
          value={vm.template}
          disabled={disabled}
          onValueChange={(v) => update({ template: v })}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {builtTemplates.map((t) => (
              <SelectItem key={t.name} value={t.name} className="text-xs">
                {t.name}
              </SelectItem>
            ))}
            {!builtTemplates.some((t) => t.name === vm.template) && vm.template && (
              <SelectItem value={vm.template} className="text-xs">
                {vm.template} (not built)
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
      <Field label="VM name">
        <Input
          className="h-8 text-sm font-mono"
          value={nameDraft}
          disabled={disabled}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            const next = restoreRangeId(nameDraft.trim(), vm.vmName, rangeId)
            if (!next || next === vm.vmName) {
              setNameDraft(expandRangeId(vm.vmName, rangeId))
              return
            }
            update({ vm_name: next })
            onVmRenamed(vm.id, next)
          }}
        />
      </Field>
      <Field label="Hostname">
        <Input
          className="h-8 text-sm font-mono"
          value={hostDraft}
          disabled={disabled}
          onChange={(e) => setHostDraft(e.target.value)}
          onBlur={() => {
            const next = restoreRangeId(hostDraft.trim(), vm.hostname, rangeId)
            if (!next || next === vm.hostname) {
              setHostDraft(expandRangeId(vm.hostname, rangeId))
              return
            }
            update({ hostname: next })
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="VLAN">
          <Input
            type="number"
            className="h-8 text-sm"
            value={vlanDraft}
            disabled={disabled}
            onChange={(e) => setVlanDraft(e.target.value)}
            onBlur={() => {
              const n = parseInt(vlanDraft, 10)
              if (!Number.isFinite(n) || n === vm.vlan) {
                setVlanDraft(String(vm.vlan))
                return
              }
              update({ vlan: n })
            }}
          />
        </Field>
        <Field label="IP last octet">
          <Input
            type="number"
            className="h-8 text-sm"
            value={octetDraft}
            disabled={disabled}
            onChange={(e) => setOctetDraft(e.target.value)}
            onBlur={() => {
              const n = parseInt(octetDraft, 10)
              if (!Number.isFinite(n) || n === vm.ipLastOctet) {
                setOctetDraft(String(vm.ipLastOctet))
                return
              }
              update({ ip_last_octet: n })
            }}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="RAM (GB)">
          <Input
            type="number"
            className="h-8 text-sm"
            value={vm.ramGb}
            disabled={disabled}
            onChange={(e) => update({ ram_gb: parseInt(e.target.value, 10) || 0 })}
          />
        </Field>
        <Field label="CPUs">
          <Input
            type="number"
            className="h-8 text-sm"
            value={vm.cpus}
            disabled={disabled}
            onChange={(e) => update({ cpus: parseInt(e.target.value, 10) || 0 })}
          />
        </Field>
      </div>

      {vm.os === "windows" && (
        <DomainRoleField vm={vm} graph={graph} apply={apply} disabled={disabled} />
      )}

      {vm.os === "windows" && (
        <ToggleRow
          label="Sysprep before tasks"
          checked={windowsSysprep(vm)}
          disabled={disabled}
          onChange={(v) => {
            const win = (vm.raw.windows && typeof vm.raw.windows === "object"
              ? { ...(vm.raw.windows as Record<string, unknown>) }
              : {}) as Record<string, unknown>
            win.sysprep = v
            update({ windows: win })
          }}
        />
      )}

      <div className="rounded-md border border-border p-2 space-y-2">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">Testing mode</p>
        <p className="text-[10px] text-muted-foreground">
          Block internet applies while the range is in testing mode. Snapshot stays off until it is turned on.
        </p>
        <ToggleRow
          label="Snapshot"
          checked={vmTestingFlag(vm, "snapshot")}
          disabled={disabled}
          onChange={(v) => update({ testing: { ...testingBlock(vm), snapshot: v } })}
        />
        <ToggleRow
          label="Block internet"
          checked={vmTestingFlag(vm, "block_internet")}
          disabled={disabled}
          onChange={(v) => update({ testing: { ...testingBlock(vm), block_internet: v } })}
        />
      </div>

      <AdvancedVmFields vm={vm} update={update} disabled={disabled} />

      <RolesEditor vm={vm} graph={graph} apply={apply} disabled={disabled} />

      {!locked && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-destructive"
          onClick={() => {
            apply((d) => removeVm(d, vm.id))
            onClose()
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete VM
        </Button>
      )}
    </div>
  )
}

function windowsSysprep(vm: BuilderVm): boolean {
  const win = vm.raw.windows
  if (win && typeof win === "object") return (win as Record<string, unknown>).sysprep === true
  return false
}
function testingBlock(vm: BuilderVm): Record<string, unknown> {
  return vm.raw.testing && typeof vm.raw.testing === "object"
    ? { ...(vm.raw.testing as Record<string, unknown>) }
    : {}
}
function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

function DomainRoleField({
  vm,
  graph,
  apply,
  disabled,
}: {
  vm: BuilderVm
  graph: BuilderGraph
  apply: InspectorProps["apply"]
  disabled: boolean
}) {
  const fqdns = graph.domains.map((d) => d.fqdn)
  const value = vm.domainFqdn ? `${vm.domainFqdn}|${vm.domainRole}` : "none"
  return (
    <Field label="Domain membership">
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={vm.domainFqdn ?? "__none__"}
          disabled={disabled}
          onValueChange={(v) => {
            if (v === "__none__") apply((d) => setDomainMembership(d, vm.id, null, "none"))
            else apply((d) => setDomainMembership(d, vm.id, v, vm.domainRole === "none" ? "member" : vm.domainRole))
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="No domain" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">No domain</SelectItem>
            {fqdns.map((f) => (
              <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={vm.domainRole === "none" ? "member" : vm.domainRole}
          disabled={disabled || !vm.domainFqdn}
          onValueChange={(v) => apply((d) => setDomainMembership(d, vm.id, vm.domainFqdn, v as DomainRole))}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="primary-dc" className="text-xs">primary-dc</SelectItem>
            <SelectItem value="alt-dc" className="text-xs">alt-dc</SelectItem>
            <SelectItem value="member" className="text-xs">member</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Type an FQDN in the domain inspector to create a new domain, then assign members here.
      </p>
    </Field>
  )
}

function AdvancedVmFields({
  vm,
  update,
  disabled,
}: {
  vm: BuilderVm
  update: (patch: Record<string, unknown>) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const groups = Array.isArray(vm.raw.ansible_groups) ? vm.raw.ansible_groups.join(", ") : ""
  const rewrites = Array.isArray(vm.raw.dns_rewrites) ? vm.raw.dns_rewrites.join(", ") : ""
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-semibold text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        Advanced
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-2">
          <ToggleRow
            label="force_ip"
            checked={vm.raw.force_ip === true}
            disabled={disabled}
            onChange={(v) => update({ force_ip: v || undefined })}
          />
          <ToggleRow
            label="unmanaged"
            checked={vm.raw.unmanaged === true}
            disabled={disabled}
            onChange={(v) => update({ unmanaged: v || undefined })}
          />
          <Field label="ansible_groups (comma-separated)">
            <Input
              className="h-8 text-xs font-mono"
              defaultValue={groups}
              disabled={disabled}
              onBlur={(e) => {
                const list = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                update({ ansible_groups: list.length ? list : undefined })
              }}
            />
          </Field>
          <Field label="dns_rewrites (comma-separated)">
            <Input
              className="h-8 text-xs font-mono"
              defaultValue={rewrites}
              disabled={disabled}
              onBlur={(e) => {
                const list = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                update({ dns_rewrites: list.length ? list : undefined })
              }}
            />
          </Field>
          <Field label="primary_dns_server">
            <Input
              className="h-8 text-xs font-mono"
              defaultValue={typeof vm.raw.primary_dns_server === "string" ? vm.raw.primary_dns_server : ""}
              disabled={disabled}
              onBlur={(e) => update({ primary_dns_server: e.target.value.trim() || undefined })}
            />
          </Field>
          <Field label="secondary_dns_server">
            <Input
              className="h-8 text-xs font-mono"
              defaultValue={typeof vm.raw.secondary_dns_server === "string" ? vm.raw.secondary_dns_server : ""}
              disabled={disabled}
              onBlur={(e) => update({ secondary_dns_server: e.target.value.trim() || undefined })}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

// ── Roles ─────────────────────────────────────────────────────────────────────

function RolesEditor({
  vm,
  graph,
  apply,
  disabled,
}: {
  vm: BuilderVm
  graph: BuilderGraph
  apply: InspectorProps["apply"]
  disabled: boolean
}) {
  const [adding, setAdding] = useState("")
  const [freeText, setFreeText] = useState("")

  const setRoles = (entries: BuilderRoleEntry[]) => apply((d) => setVmRoles(d, vm.id, entries))

  const addRole = (name: string) => {
    if (!name.trim()) return
    if (vm.roles.some((r) => r.name === name)) return
    setRoles([...vm.roles, { name: name.trim(), dependsOn: [] }])
  }

  return (
    <div className="rounded-md border border-border p-2 space-y-2">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">Ansible roles</p>
      {vm.roles.length === 0 && <p className="text-xs text-muted-foreground">No roles on this VM.</p>}
      {vm.roles.map((role) => (
        <RoleRow
          key={role.name}
          vm={vm}
          role={role}
          disabled={disabled}
          onRemove={() => setRoles(vm.roles.filter((r) => r.name !== role.name))}
          apply={apply}
        />
      ))}
      {!disabled && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <Select value={adding} onValueChange={(v) => { setAdding(""); addRole(v) }}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Add windows_utils role…" />
            </SelectTrigger>
            <SelectContent>
              {LUDUS_WINDOWS_UTILS_ROLES.map((r) => (
                <SelectItem key={r.short} value={r.fqcn} className="text-xs">
                  {r.short}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1.5">
            <Input
              className="h-8 text-xs font-mono"
              placeholder="any.galaxy.role"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => { addRole(freeText); setFreeText("") }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      {graph.dependsOn.filter((e) => e.fromVmId === vm.id).length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          depends_on edges are shown on the canvas; click one to edit it.
        </p>
      )}
    </div>
  )
}

function RoleRow({
  vm,
  role,
  disabled,
  onRemove,
  apply,
}: {
  vm: BuilderVm
  role: BuilderRoleEntry
  disabled: boolean
  onRemove: () => void
  apply: InspectorProps["apply"]
}) {
  const [open, setOpen] = useState(false)
  const def = findLudusRoleDef(role.name)
  const isTrust = roleShortName(role.name) === FOREST_TRUST_ROLE
  return (
    <div className="rounded border border-border">
      <div className="flex items-center justify-between px-2 py-1">
        <button
          type="button"
          className="truncate text-left text-xs font-mono"
          onClick={() => setOpen((v) => !v)}
          title={role.name}
        >
          {roleShortName(role.name)}
        </button>
        <div className="flex items-center gap-1">
          {def && (
            <Badge variant="secondary" className="text-[9px]">{def.fields.length} vars</Badge>
          )}
          {!disabled && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove} aria-label="Remove role">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {open && def && (
        <div className="space-y-2 border-t border-border p-2">
          {isTrust && (
            <p className="text-[10px] text-muted-foreground">
              Partner fields are set by the trust edge; edit the trust from its canvas edge.
            </p>
          )}
          {def.fields
            .filter((f) => !(isTrust && f.managed))
            .map((f) => (
              <RoleVarField key={f.key} vm={vm} field={f} apply={apply} disabled={disabled} />
            ))}
        </div>
      )}
      {open && !def && (
        <div className="border-t border-border p-2">
          <p className="text-[10px] text-muted-foreground">
            Unknown role. Edit its variables under role_vars in the VM, or in Configuration YAML.
          </p>
        </div>
      )}
    </div>
  )
}

function RoleVarField({
  vm,
  field,
  apply,
  disabled,
}: {
  vm: BuilderVm
  field: RoleField
  apply: InspectorProps["apply"]
  disabled: boolean
}) {
  const current = vm.roleVars[field.key]
  const setVar = (value: unknown) => apply((d) => setVmRoleVars(d, vm.id, { [field.key]: value }))

  if (field.kind === "boolean") {
    return (
      <ToggleRow
        label={field.label}
        checked={current === true}
        disabled={disabled}
        onChange={(v) => setVar(v || undefined)}
      />
    )
  }
  if (field.kind === "select" && field.options) {
    return (
      <Field label={field.label}>
        <Select
          value={current != null ? String(current) : ""}
          disabled={disabled}
          onValueChange={(v) => setVar(v)}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="default" /></SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    )
  }
  if (field.kind === "number") {
    return (
      <Field label={field.label}>
        <Input
          type="number"
          className="h-8 text-xs"
          defaultValue={current != null ? String(current) : ""}
          disabled={disabled}
          onBlur={(e) => {
            const n = e.target.value === "" ? undefined : Number(e.target.value)
            setVar(Number.isFinite(n) ? n : undefined)
          }}
        />
      </Field>
    )
  }
  if (field.kind === "yaml") {
    return (
      <Field label={field.label}>
        <Textarea
          className="min-h-[60px] text-xs font-mono"
          defaultValue={current != null ? yaml.dump(current).trimEnd() : ""}
          disabled={disabled}
          placeholder="YAML value"
          onBlur={(e) => {
            const text = e.target.value.trim()
            if (!text) return setVar(undefined)
            try {
              setVar(yaml.load(text))
            } catch {
              /* keep previous value on invalid YAML */
            }
          }}
        />
      </Field>
    )
  }
  return (
    <Field label={field.label}>
      <Input
        className="h-8 text-xs font-mono"
        defaultValue={current != null ? String(current) : ""}
        placeholder={field.placeholder}
        disabled={disabled}
        onBlur={(e) => setVar(e.target.value.trim() || undefined)}
      />
    </Field>
  )
}

// ── VLAN ──────────────────────────────────────────────────────────────────────

function VlanInspector({ vlan, graph, apply, locked, rangeNumber, onClose }: InspectorProps & { vlan: number }) {
  const [value, setValue] = useState(String(vlan))
  useEffect(() => {
    setValue(String(vlan))
  }, [vlan])
  const members = graph.vlans.find((v) => v.vlan === vlan)?.vmIds ?? []
  return (
    <div className="space-y-3">
      {locked && <LockedBanner />}
      <Field label="VLAN id (2–255)">
        <div className="flex gap-1.5">
          <Input
            type="number"
            className="h-8 text-sm"
            value={value}
            disabled={locked}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={locked}
            onClick={() => {
              const n = parseInt(value, 10)
              if (locked || !Number.isFinite(n) || n === vlan) return
              apply((d) => renumberVlan(d, vlan, n, rangeNumber))
            }}
          >
            Apply
          </Button>
        </div>
      </Field>
      <p className="text-xs text-muted-foreground">
        {members.length} VM{members.length === 1 ? "" : "s"} on this VLAN. Renumbering updates every
        member and any firewall rule that references it.
      </p>
      {members.length === 0 && !locked && (
        <p className="text-xs text-muted-foreground">
          Empty VLANs disappear once no VM references them; drag a VM here or delete its VMs.
        </p>
      )}
      <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
        Done
      </Button>
    </div>
  )
}

// ── Domain ────────────────────────────────────────────────────────────────────

function DomainInspector({
  fqdn,
  graph,
  apply,
  locked,
  onDomainRenamed,
  findings,
}: InspectorProps & { fqdn: string }) {
  const [name, setName] = useState(fqdn)
  useEffect(() => {
    setName(fqdn)
  }, [fqdn])
  const defaults = graph.rangeDefaults
  const setDefault = (key: string, value: string) => apply((d) => setRangeDefaults(d, { [key]: value || undefined }))

  const domainId = `domain:${fqdn}`
  const domainFindings = findings.filter(
    (finding) => finding.nodeId === domainId || (finding.nodeId != null && finding.nodeId.startsWith(`${domainId}@`)),
  )
  return (
    <div className="space-y-3">
      {locked && <LockedBanner />}
      <FindingNotes findings={domainFindings} />
      <Field label="Domain FQDN">
        <div className="flex gap-1.5">
          <Input
            className="h-8 text-sm font-mono"
            value={name}
            disabled={locked}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={locked}
            onClick={() => {
              const next = name.trim()
              if (!next || next === fqdn) return
              apply((d) => renameDomain(d, fqdn, next))
              onDomainRenamed(fqdn, next)
            }}
          >
            Rename
          </Button>
        </div>
      </Field>

      <div className="rounded-md border border-border p-2 space-y-2">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          Range defaults (all domains)
        </p>
        <DefaultText label="Domain admin" k="ad_domain_admin" defaults={defaults} onSet={setDefault} disabled={locked} />
        <DefaultText label="Domain admin password" k="ad_domain_admin_password" defaults={defaults} onSet={setDefault} disabled={locked} />
        <DefaultText label="Domain user" k="ad_domain_user" defaults={defaults} onSet={setDefault} disabled={locked} />
        <DefaultText label="Domain user password" k="ad_domain_user_password" defaults={defaults} onSet={setDefault} disabled={locked} />
        <DefaultText label="Safe mode password" k="ad_domain_safe_mode_password" defaults={defaults} onSet={setDefault} disabled={locked} />
        <DefaultSelect
          label="Domain functional level"
          k="ad_domain_functional_level"
          defaults={defaults}
          options={FUNCTIONAL_LEVELS}
          onSet={setDefault}
          disabled={locked}
        />
        <DefaultSelect
          label="Forest functional level"
          k="ad_forest_functional_level"
          defaults={defaults}
          options={FUNCTIONAL_LEVELS}
          onSet={setDefault}
          disabled={locked}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Drag from this domain to another to create a forest trust.
      </p>
    </div>
  )
}

function DefaultText({
  label,
  k,
  defaults,
  onSet,
  disabled,
}: {
  label: string
  k: string
  defaults: Record<string, unknown>
  onSet: (k: string, v: string) => void
  disabled: boolean
}) {
  return (
    <Field label={label}>
      <Input
        className="h-8 text-xs font-mono"
        defaultValue={typeof defaults[k] === "string" ? (defaults[k] as string) : ""}
        disabled={disabled}
        onBlur={(e) => onSet(k, e.target.value.trim())}
      />
    </Field>
  )
}

function DefaultSelect({
  label,
  k,
  defaults,
  options,
  onSet,
  disabled,
}: {
  label: string
  k: string
  defaults: Record<string, unknown>
  options: string[]
  onSet: (k: string, v: string) => void
  disabled: boolean
}) {
  return (
    <Field label={label}>
      <Select
        value={typeof defaults[k] === "string" ? (defaults[k] as string) : ""}
        disabled={disabled}
        onValueChange={(v) => onSet(k, v)}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="server default" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("truncate text-right", mono && "font-mono")}>{value}</span>
    </div>
  )
}

// ── Router ────────────────────────────────────────────────────────────────────

function RouterInspector({ graph, apply, locked, routerDetails, rangeNumber }: InspectorProps) {
  const r = graph.router
  const set = (key: string, value: unknown) => apply((d) => setRouter(d, { [key]: value }))
  const live = routerDetails.live
  return (
    <div className="space-y-3">
      {locked && <LockedBanner />}
      <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2 text-xs">
        <p className="font-semibold">Ludus router</p>
        <Detail label="Template" value={routerDetails.template} />
        <Detail label="Built" value={routerDetails.built ? "Yes" : "Not built"} />
        <Detail label="vm_name" value={routerDetails.vmName} mono />
        <Detail label="Hostname" value={routerDetails.hostname || live?.name || "Ludus default"} mono />
        <Detail
          label="RAM / CPUs"
          value={
            routerDetails.ramGb != null || routerDetails.cpus != null
              ? `${routerDetails.ramGb ?? "default"} GB · ${routerDetails.cpus ?? "default"} CPU`
              : "Ludus default"
          }
        />
        {live ? (
          <>
            <Detail label="Power" value={live.poweredOn ? "Running" : "Stopped"} />
            <Detail label="IP" value={live.ip || "none"} mono />
            <Detail label="Proxmox ID" value={String(live.proxmoxId)} mono />
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">Not deployed yet. Ludus clones this template on deploy.</p>
        )}
        <div className="pt-1">
          <p className="text-[11px] font-medium text-muted-foreground">Gateways</p>
          {routerDetails.gateways.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No VLANs yet.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
              {routerDetails.gateways.map((gw) => (
                <li key={gw.vlan}>
                  VLAN {gw.vlan}
                  {gw.address ? ` · ${gw.address}` : ""}
                </li>
              ))}
            </ul>
          )}
          {rangeNumber == null && routerDetails.gateways.length > 0 && (
            <p className="mt-1 text-[10px] text-muted-foreground">Gateway addresses appear once the range number is known.</p>
          )}
        </div>
      </div>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          The fields below pin YAML overrides. Leave them empty to keep the resolved router above.
        </AlertDescription>
      </Alert>
      <Field label="vm_name">
        <Input
          className="h-8 text-xs font-mono"
          defaultValue={r.vmName ?? ""}
          disabled={locked}
          onBlur={(e) => set("vm_name", e.target.value.trim() || undefined)}
        />
      </Field>
      <Field label="hostname">
        <Input
          className="h-8 text-xs font-mono"
          defaultValue={r.hostname ?? ""}
          disabled={locked}
          onBlur={(e) => set("hostname", e.target.value.trim() || undefined)}
        />
      </Field>
      <Field label="template">
        <Input
          className="h-8 text-xs font-mono"
          defaultValue={r.template ?? ""}
          disabled={locked}
          onBlur={(e) => set("template", e.target.value.trim() || undefined)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="ram_gb">
          <Input
            type="number"
            className="h-8 text-xs"
            defaultValue={r.ramGb ?? ""}
            disabled={locked}
            onBlur={(e) => set("ram_gb", e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </Field>
        <Field label="cpus">
          <Input
            type="number"
            className="h-8 text-xs"
            defaultValue={r.cpus ?? ""}
            disabled={locked}
            onBlur={(e) => set("cpus", e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </Field>
      </div>
    </div>
  )
}

// ── Firewall rule ─────────────────────────────────────────────────────────────

function RuleInspector({
  ruleIndex,
  mirrorIndex,
  graph,
  apply,
  onClose,
  rangeNumber,
}: InspectorProps & { ruleIndex: number; mirrorIndex?: number }) {
  const rule = graph.rules[ruleIndex]
  const rules = useMemo(() => graph.rules, [graph.rules])
  const srcValue = rule?.vlan_src
  const dstValue = rule?.vlan_dst
  const [srcDraft, setSrcDraft] = useState(srcValue == null ? "" : String(srcValue))
  const [dstDraft, setDstDraft] = useState(dstValue == null ? "" : String(dstValue))
  const [srcIp, setSrcIp] = useState("")
  const [dstIp, setDstIp] = useState("")
  useEffect(() => {
    setSrcDraft(srcValue == null ? "" : String(srcValue))
    setDstDraft(dstValue == null ? "" : String(dstValue))
  }, [ruleIndex, srcValue, dstValue])
  useEffect(() => {
    setSrcIp(rule ? displayHostAddress(rule.vlan_src, rule.ip_last_octet_src, rangeNumber) : "")
    setDstIp(rule ? displayHostAddress(rule.vlan_dst, rule.ip_last_octet_dst, rangeNumber) : "")
  }, [rangeNumber, rule, rule?.ip_last_octet_dst, rule?.ip_last_octet_src, rule?.vlan_dst, rule?.vlan_src])
  if (!rule) return <Empty />

  const update = (patch: Partial<NetworkRule>) => {
    const next = rules.map((r, i) => (i === ruleIndex ? { ...r, ...patch } : r))
    apply((d) => setNetworkRules(d, next))
  }
  const mirror = mirrorIndex != null && mirrorIndex !== ruleIndex ? rules[mirrorIndex] : undefined
  const mirrorDiffers =
    mirror != null &&
    (mirror.protocol !== rule.protocol || mirror.ports !== rule.ports || mirror.action !== rule.action)
  const del = () => {
    const drop = new Set([ruleIndex])
    if (mirrorIndex != null) drop.add(mirrorIndex)
    apply((d) => setNetworkRules(d, rules.filter((_, i) => !drop.has(i))))
    onClose()
  }

  return (
    <div className="space-y-3">
      <Field label="Rule name">
        <Input
          className="h-8 text-sm"
          value={rule.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Source VLAN">
          <Input
            className="h-8 text-xs font-mono"
            value={srcDraft}
            onChange={(e) => setSrcDraft(e.target.value)}
            onBlur={() => {
              const next = coerceVlan(srcDraft)
              if (next === rule.vlan_src) {
                setSrcDraft(String(rule.vlan_src))
                return
              }
              update({ vlan_src: next })
            }}
          />
        </Field>
        <Field label="Destination VLAN">
          <Input
            className="h-8 text-xs font-mono"
            value={dstDraft}
            onChange={(e) => setDstDraft(e.target.value)}
            onBlur={() => {
              const next = coerceVlan(dstDraft)
              if (next === rule.vlan_dst) {
                setDstDraft(String(rule.vlan_dst))
                return
              }
              update({ vlan_dst: next })
            }}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Source IP">
          <Input
            className="h-8 text-xs font-mono"
            value={srcIp}
            placeholder="Whole subnet"
            onChange={(e) => setSrcIp(e.target.value)}
            onBlur={() => {
              if (!isHostAddress(srcIp)) {
                setSrcIp(displayHostAddress(rule.vlan_src, rule.ip_last_octet_src, rangeNumber))
                return
              }
              update({ ip_last_octet_src: normalizeIpLastOctet(srcIp) })
            }}
          />
        </Field>
        <Field label="Destination IP">
          <Input
            className="h-8 text-xs font-mono"
            value={dstIp}
            placeholder="Whole subnet"
            onChange={(e) => setDstIp(e.target.value)}
            onBlur={() => {
              if (!isHostAddress(dstIp)) {
                setDstIp(displayHostAddress(rule.vlan_dst, rule.ip_last_octet_dst, rangeNumber))
                return
              }
              update({ ip_last_octet_dst: normalizeIpLastOctet(dstIp) })
            }}
          />
        </Field>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Leave an address blank to cover the whole subnet. A full address is stored as that host&apos;s last octet.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Protocol">
          <Select value={rule.protocol} onValueChange={(v) => update({ protocol: v as Protocol, ports: v === "all" ? "all" : rule.ports })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">all</SelectItem>
              <SelectItem value="tcp" className="text-xs">tcp</SelectItem>
              <SelectItem value="udp" className="text-xs">udp</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Ports">
          <Input
            className={cn("h-8 text-xs font-mono", rule.protocol === "all" && "opacity-40")}
            value={rule.protocol === "all" ? "" : rule.ports}
            disabled={rule.protocol === "all"}
            onChange={(e) => update({ ports: e.target.value })}
          />
        </Field>
        <Field label="Action">
          <Select value={rule.action} onValueChange={(v) => update({ action: v as RuleAction })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ACCEPT" className="text-xs">ACCEPT</SelectItem>
              <SelectItem value="REJECT" className="text-xs">REJECT</SelectItem>
              <SelectItem value="DROP" className="text-xs">DROP</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {mirror && (
        <p className="text-[10px] text-muted-foreground">
          {mirrorDiffers
            ? `Reverse rule: ${mirror.protocol}/${mirror.ports} ${mirror.action}. Deleting removes both directions.`
            : "This line includes the reverse rule. Deleting removes both directions."}
        </p>
      )}
      <Button variant="outline" size="sm" className="w-full text-destructive" onClick={del}>
        <Trash2 className="h-4 w-4" /> Delete rule
      </Button>
    </div>
  )
}

function coerceVlan(v: string): NetworkRule["vlan_src"] {
  const lower = v.trim().toLowerCase()
  if (lower === "wireguard" || lower === "public" || lower === "all") return lower
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? "all" : n
}

// ── Trust ─────────────────────────────────────────────────────────────────────

function TrustInspector({
  sourceVmId,
  graph,
  apply,
  locked,
  onClose,
  rangeId,
}: InspectorProps & { sourceVmId: string }) {
  const link = trustLinks(graph.trusts, graph.domains).find((entry) => entry.sourceVmId === sourceVmId)
  const vm = graph.vms.find((v) => v.id === sourceVmId)
  if (!link) return <Empty />
  const members = vm?.roleVars.ludus_cross_domain_group_members
  const derived = sourceVmId.startsWith("goad:") || sourceVmId.startsWith("child:")
  return (
    <div className="space-y-3">
      {locked && <LockedBanner />}
      <p className="text-sm font-medium">{trustLabel(link)}</p>
      <p className="text-sm">
        <span className="font-mono">{link.fromFqdn}</span>
        {link.relation === "parent-child" ? " is a child of " : link.direction === "two-way" ? " and " : " trusts "}
        <span className="font-mono">{link.toFqdn}</span>
        {link.relation === "forest" && link.direction === "two-way" ? " trust each other" : ""}
      </p>
      {link.relation === "parent-child" && (
        <p className="text-xs text-muted-foreground">
          Active Directory creates this trust in both directions when the child domain is promoted.
        </p>
      )}
      {sourceVmId.startsWith("goad:") && (
        <p className="text-xs text-muted-foreground">This forest trust comes from the GOAD lab definition.</p>
      )}
      {vm && link.relation === "forest" && (
        <>
          <p className="text-xs text-muted-foreground">
            Role <code className="text-primary">ludus_ad_forest_trust</code> on {expandRangeId(vm.vmName, rangeId)}.
            Partner DC {String(vm.roleVars.ludus_trust_partner_dc_ip ?? "—")}.
          </p>
          <ToggleRow
            label="Enable SID history"
            checked={vm.roleVars.ludus_enable_sid_history === true}
            disabled={locked}
            onChange={(v) => apply((d) => setVmRoleVars(d, sourceVmId, { ludus_enable_sid_history: v || undefined }))}
          />
          <Field label="Cross-domain group members (YAML, optional)">
            <Textarea
              className="min-h-[70px] text-xs font-mono"
              defaultValue={members != null ? yaml.dump(members).trimEnd() : ""}
              disabled={locked}
              onBlur={(e) => {
                const text = e.target.value.trim()
                if (!text) return apply((d) => setVmRoleVars(d, sourceVmId, { ludus_cross_domain_group_members: undefined }))
                try {
                  const parsed = yaml.load(text)
                  apply((d) => setVmRoleVars(d, sourceVmId, { ludus_cross_domain_group_members: parsed }))
                } catch {
                  /* ignore invalid YAML */
                }
              }}
            />
          </Field>
        </>
      )}
      {!locked && !derived && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-destructive"
          onClick={() => { apply((d) => removeForestTrust(d, sourceVmId)); onClose() }}
        >
          <Trash2 className="h-4 w-4" /> Remove trust
        </Button>
      )}
    </div>
  )
}

// ── depends_on ────────────────────────────────────────────────────────────────

function DependsInspector({
  edge,
  graph,
  apply,
  locked,
  onClose,
}: InspectorProps & { edge: DependsSelectionEdge }) {
  const vm = graph.vms.find((v) => v.id === edge.fromVmId)
  if (!vm) return <Empty />
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-mono">{roleShortName(edge.fromRole)}</span> on {vm.vmName} waits for{" "}
        <span className="font-mono">{roleShortName(edge.toRole)}</span> on {edge.toVmName}.
      </p>
      {!locked && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-destructive"
          onClick={() => {
            const entries = vm.roles.map((r) =>
              r.name === edge.fromRole
                ? { ...r, dependsOn: r.dependsOn.filter((d) => !(d.vmName === edge.toVmName && d.role === edge.toRole)) }
                : r,
            )
            apply((d) => setVmRoles(d, vm.id, entries))
            onClose()
          }}
        >
          <Trash2 className="h-4 w-4" /> Remove dependency
        </Button>
      )}
    </div>
  )
}
