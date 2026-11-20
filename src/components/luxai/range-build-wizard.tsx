"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NetworkRulesEditor } from "@/components/range/network-rules-editor"
import { RangeIdHostnameNote } from "@/components/range/range-id-hostname-note"
import { hostnameIncludesRangeId, hostnameWithoutRangeId, RANGE_ID_HOSTNAME_NOTE } from "@/lib/range/hostname-range-id"
import type { NetworkRule, VlanValue } from "@/lib/range/network-rules"
import { applyChoiceLabel, chosenSelectId, existingRangeSelected, rangeBuildWizardSteps, reviewContinueError, reviewStepDetail, type BuildWizardStep } from "@/lib/luxai/build-wizard-steps"
import {
  defaultNetworks,
  defaultVmRows,
  domainJoinWarnings,
  nextVmRow,
  parseRangeNetworks,
  parseRangeRules,
  parseRangeVms,
  templatesForRole,
  validateDomain,
  validateNetworks,
  validateRangeId,
  validateRangeName,
  validateRangeVms,
  validateRules,
  type RangeNetworkDraft,
  type RangeRuleDraft,
  type RangeVmDraft,
} from "@/lib/luxai/range-vms"
import type { LuxaiChoice, LuxaiChoiceField } from "@/lib/luxai/types"
import { cn } from "@/lib/core/utils"

const denseSelect = "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
const vmRowClass = "grid grid-cols-[minmax(7rem,1.1fr)_minmax(10rem,1.3fr)_minmax(12rem,1.6fr)_9rem_2rem] items-center gap-1"
const fieldSelect = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

function vlanDraft(value: VlanValue): string {
  return String(value)
}

function vlanEditor(value: string): VlanValue {
  if (value === "all" || value === "public" || value === "wireguard") return value
  const number = Number(value)
  return Number.isInteger(number) ? number : 10
}

function rulesForEditor(rows: RangeRuleDraft[]): NetworkRule[] {
  return rows.map((row) => {
    const rule: NetworkRule = {
      name: row.name,
      vlan_src: vlanEditor(row.vlanSrc),
      vlan_dst: vlanEditor(row.vlanDst),
      protocol: row.protocol === "udp" || row.protocol === "tcp" ? row.protocol : "all",
      ports: row.protocol === "all" ? "all" : row.ports,
      action: row.action === "REJECT" || row.action === "DROP" ? row.action : "ACCEPT",
    }
    if (row.ipLastOctetSrc) rule.ip_last_octet_src = row.ipLastOctetSrc
    if (row.ipLastOctetDst) rule.ip_last_octet_dst = row.ipLastOctetDst
    return rule
  })
}

function rulesFromEditor(rows: NetworkRule[]): RangeRuleDraft[] {
  return rows.map((row) => ({
    name: row.name,
    vlanSrc: vlanDraft(row.vlan_src),
    vlanDst: vlanDraft(row.vlan_dst),
    protocol: row.protocol,
    ports: row.protocol === "all" ? "all" : row.ports,
    action: row.action,
    ipLastOctetSrc: row.ip_last_octet_src,
    ipLastOctetDst: row.ip_last_octet_dst,
  }))
}

export function NetworkRows({
  rows,
  disabled,
  onChange,
}: {
  rows: RangeNetworkDraft[]
  disabled: boolean
  onChange: (rows: RangeNetworkDraft[]) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">VLAN</p>
      {rows.map((row, index) => (
        <div key={index} className="flex gap-1">
          <Input
            aria-label={`Network ${index + 1} VLAN`}
            className="h-8"
            value={row.vlan}
            disabled={disabled}
            onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { vlan: event.target.value } : item))}
          />
          <Button type="button" size="sm" variant="ghost" className="h-8 w-8 px-0" aria-label={`Remove network ${index + 1}`} disabled={disabled} onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange([...rows, { vlan: "" }])}>
        <Plus className="mr-1 h-4 w-4" />
        Add network
      </Button>
    </div>
  )
}

export function FirewallRules({
  rows,
  networks,
  disabled,
  onChange,
}: {
  rows: RangeRuleDraft[]
  networks: RangeNetworkDraft[]
  disabled: boolean
  onChange: (rows: RangeRuleDraft[]) => void
}) {
  const availableVlans = networks.map((row) => Number(row.vlan)).filter((vlan) => Number.isInteger(vlan))
  return (
    <div className={disabled ? "pointer-events-none opacity-80" : undefined}>
      <NetworkRulesEditor
        rules={rulesForEditor(rows)}
        availableVlans={availableVlans}
        onChange={(next) => onChange(rulesFromEditor(next))}
        emptyMessage="No firewall rules yet. Ludus accepts inter-VLAN and external traffic until you add one."
      />
    </div>
  )
}

export function VmRows({
  rows,
  roles,
  templates,
  networks,
  disabled,
  onChange,
}: {
  rows: RangeVmDraft[]
  roles: Array<{ id: string; label: string; detail?: string }>
  templates: Array<{ id: string; os: string; built?: boolean }>
  networks: RangeNetworkDraft[]
  disabled: boolean
  onChange: (rows: RangeVmDraft[]) => void
}) {
  useEffect(() => {
    const next = rows.map((row) => {
      const ready = templatesForRole(row.role, templates).filter((item) => item.built !== false)
      if (ready.some((item) => item.id === row.template)) return row
      return { ...row, template: ready[0]?.id ?? "" }
    })
    if (next.some((row, index) => row.template !== rows[index]?.template)) onChange(next)
  }, [rows, templates, onChange])
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[46rem] space-y-1">
      <div className={cn(vmRowClass, "text-xs text-muted-foreground")}>
        <span>Hostname</span>
        <span>Role</span>
        <span>Template</span>
        <span>VLAN</span>
        <span className="sr-only">Remove</span>
      </div>
      {rows.map((row, index) => {
        const listed = templatesForRole(row.role, templates)
        const ready = listed.filter((item) => item.built !== false)
        const emptyTemplate = row.role === "primary-dc" || row.role === "alt-dc" || row.role === "member"
          ? "No built Windows Server template"
          : row.role === "workstation"
            ? "No built Windows workstation template"
            : "No built template"
        return (
          <div key={`${index}-${row.role}`} className={vmRowClass}>
            <div>
              <Input
                aria-label={`VM ${index + 1} hostname`}
                className="h-8 text-sm"
                value={row.hostname}
                disabled={disabled}
                onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, hostname: event.target.value } : item))}
              />
              <RangeIdHostnameNote value={row.hostname} />
            </div>
            <select
              aria-label={`VM ${index + 1} role`}
              className={denseSelect}
              value={row.role}
              disabled={disabled}
              onChange={(event) => {
                const role = event.target.value
                const nextAllowed = templatesForRole(role, templates).filter((item) => item.built !== false)
                const template = nextAllowed.some((item) => item.id === row.template) ? row.template : (nextAllowed[0]?.id ?? "")
                onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, role, template } : item))
              }}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.label}</option>
              ))}
            </select>
            <select
              aria-label={`VM ${index + 1} template`}
              className={denseSelect}
              value={ready.some((item) => item.id === row.template) ? row.template : ""}
              disabled={disabled}
              onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, template: event.target.value } : item))}
            >
              {ready.length === 0 ? <option value="">{emptyTemplate}</option> : null}
              {listed.map((item) => (
                <option key={item.id} value={item.id} disabled={item.built === false}>
                  {item.built === false ? `${item.id} (not built)` : item.id}
                </option>
              ))}
            </select>
            <select
              aria-label={`VM ${index + 1} VLAN`}
              className={denseSelect}
              value={row.vlan}
              disabled={disabled}
              onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, vlan: event.target.value } : item))}
            >
              {networks.map((network) => (
                <option key={network.vlan} value={network.vlan}>{network.vlan ? `VLAN ${network.vlan}` : "VLAN"}</option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 px-0"
              aria-label={`Remove VM ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      })}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2"
        disabled={disabled}
        onClick={() => onChange([...rows, nextVmRow(rows, templates, networks[0]?.vlan || "10")])}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add VM
      </Button>
    </div>
  )
}

function fieldById(fields: LuxaiChoiceField[], id: string): LuxaiChoiceField | undefined {
  return fields.find((field) => field.id === id)
}

function chosen(fields: LuxaiChoiceField[], values: Record<string, string>, id: string): string {
  return chosenSelectId(fieldById(fields, id), values)
}

function optionLabel(field: LuxaiChoiceField | undefined, id: string): string {
  return field?.options?.find((option) => option.id === id)?.label || id
}

function StepIndicator({
  steps,
  index,
  onJump,
}: {
  steps: BuildWizardStep[]
  index: number
  onJump: (index: number) => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {steps.map((step, itemIndex) => (
        <div key={step.id} className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold",
              itemIndex < index
                ? "border-status-success/40 bg-status-success/20 text-status-success"
                : itemIndex === index
                  ? "border-primary/40 bg-primary/20 text-primary"
                  : "border-border bg-muted text-muted-foreground",
            )}
            disabled={itemIndex > index}
            aria-current={itemIndex === index ? "step" : undefined}
            onClick={() => {
              if (itemIndex < index) onJump(itemIndex)
            }}
          >
            {itemIndex < index ? <Check className="h-3.5 w-3.5" /> : itemIndex + 1}
          </button>
          <span className={cn("text-sm", itemIndex === index ? "font-medium text-foreground" : "text-muted-foreground")}>
            {step.label}
          </span>
          {itemIndex < steps.length - 1 ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
        </div>
      ))}
    </div>
  )
}

export function RangeBuildWizard({
  choice,
  onSubmit,
  initialValues,
  initialSelected,
  initialIndex = 0,
  locked = false,
}: {
  choice: LuxaiChoice
  onSubmit: (selected: string[], values: Record<string, string>) => void
  initialValues?: Record<string, string>
  initialSelected?: string[]
  /** Opens on this step. Past the end lands on review. */
  initialIndex?: number
  locked?: boolean
}) {
  const fields = choice.fields ?? []
  const hasKind = fields.some((field) => field.id === "kind")
  const vmsField = fieldById(fields, "vms")
  const templateChoices = (vmsField?.options ?? []).map((option) => ({ id: option.id, os: option.detail || "", built: option.disabled ? false : undefined }))
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries((initialSelected ?? []).map((id) => [id, true])))
  const [values, setValues] = useState<Record<string, string>>({ vlan: "10", ...initialValues })
  const [sent, setSent] = useState(locked)
  const sending = useRef(false)
  const [index, setIndex] = useState(initialIndex)
  const [error, setError] = useState("")
  const [networks, setNetworks] = useState<RangeNetworkDraft[]>(() => {
    const saved = initialValues?.networks ? parseRangeNetworks(initialValues.networks) : []
    return saved.length > 0 ? saved : defaultNetworks()
  })
  const [rules, setRules] = useState<RangeRuleDraft[]>(() => initialValues?.rules ? parseRangeRules(initialValues.rules) : [])
  const [vmRows, setVmRows] = useState<RangeVmDraft[]>(() => {
    const saved = initialValues?.vms ? parseRangeVms(initialValues.vms) : []
    return saved.length > 0 ? saved : defaultVmRows(templateChoices)
  })
  const kind = chosen(fields, values, "kind") || "ludus"
  const start = chosen(fields, values, "start") || "scratch"
  const steps = rangeBuildWizardSteps({ hasKind, kind: hasKind ? kind : "", start })
  const safeIndex = Math.min(index, steps.length - 1)
  const step = steps[safeIndex]
  const disabled = sent || locked
  const extensionField = fieldById(fields, "extensions")
  const selectedExtensions = (extensionField?.options ?? []).filter((option) => picked[option.id])

  function setValue(id: string, value: string) {
    setValues((current) => ({ ...current, [id]: value }))
    setError("")
  }

  function stepError(): string {
    if (step.id === "range") {
      const mode = chosen(fields, values, "rangeMode") || "new"
      if (mode !== "new") return ""
      return validateRangeId(values.rangeId || "") || validateRangeName(values.name || "")
    }
    if (step.id === "blueprint") {
      const id = chosen(fields, values, "blueprint")
      const option = fieldById(fields, "blueprint")?.options?.find((item) => item.id === id)
      if (!id || option?.disabled) return option?.label || "No blueprints are available to this account."
      return ""
    }
    if (step.id === "networks") return validateNetworks(networks)
    if (step.id === "vms") return validateRangeVms(vmRows, templateChoices, networks)
    if (step.id === "domain") return validateDomain(values.domain || "", vmRows)
    if (step.id === "rules") return validateRules(rules, steps.some((item) => item.id === "networks") ? networks : undefined)
    if (step.id === "review") return reviewContinueError(Boolean(fieldById(fields, "action")), values.action, existingRangeSelected(values.rangeMode))
    return ""
  }

  function advance() {
    const message = stepError()
    if (message) {
      setError(message)
      return
    }
    setError("")
    setIndex(safeIndex + 1)
  }

  function submit() {
    if (sent || sending.current) return
    const message = stepError()
    if (message) {
      setError(message)
      return
    }
    const next = { ...values }
    for (const field of fields) {
      if (field.kind !== "select" || next[field.id]) continue
      const fallback = chosenSelectId(field, next)
      if (fallback) next[field.id] = fallback
    }
    if (steps.some((item) => item.id === "networks")) {
      next.networks = JSON.stringify(networks.map((row) => ({ vlan: row.vlan.trim() })))
    }
    if (steps.some((item) => item.id === "vms")) {
      next.vms = JSON.stringify(vmRows.map((row) => ({
        hostname: hostnameWithoutRangeId(row.hostname.trim()),
        role: row.role,
        template: row.template,
        vlan: row.vlan.trim(),
        ...(row.domain?.trim() || (row.role === "primary-dc" && vmRows.filter((item) => item.role === "primary-dc").length === 1 && (values.domain || "").trim())
          ? { domain: row.domain?.trim() || (values.domain || "").trim() }
          : {}),
        ...(row.domainJoin ? { domainJoin: true } : {}),
      })))
    }
    if (steps.some((item) => item.id === "rules")) {
      next.rules = JSON.stringify(rules.map((row) => ({
        name: row.name.trim(),
        vlanSrc: row.vlanSrc.trim(),
        vlanDst: row.vlanDst.trim(),
        protocol: row.protocol,
        ports: row.protocol === "all" ? "all" : row.ports.trim(),
        action: row.action,
        ...(row.ipLastOctetSrc ? { ipLastOctetSrc: row.ipLastOctetSrc } : {}),
        ...(row.ipLastOctetDst ? { ipLastOctetDst: row.ipLastOctetDst } : {}),
      })))
    }
    sending.current = true
    setSent(true)
    onSubmit(selectedExtensions.map((option) => option.id), next)
  }

  const summary = summaryLines({
    fields,
    values,
    kind,
    start,
    hasKind,
    networks,
    vmRows,
    rules,
    extensions: selectedExtensions.map((option) => option.label),
    roles: vmsField?.roles ?? [],
  })

  return (
    <form
      className="rounded-md border border-border bg-card px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled) return
        // Enter in a field moves one step. The review step sends only from Continue.
        if (safeIndex < steps.length - 1) advance()
      }}
    >
      <p className="text-sm leading-relaxed">{choice.prompt}</p>
      {locked ? null : (
        <StepIndicator steps={steps} index={safeIndex} onJump={(next) => { setError(""); setIndex(next) }} />
      )}
      <div className="mt-3 space-y-3">
        {locked ? (
          <ul className="space-y-1 text-sm">
            {summary.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{step.id === "review" ? reviewStepDetail(existingRangeSelected(values.rangeMode)) : step.detail}</p>
            {step.id === "review" ? (
              <ul className="space-y-1 text-sm">
                {summary.map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : null}
            <StepFields
              step={step}
              fields={fields}
              values={values}
              disabled={disabled}
              networks={networks}
              rules={rules}
              vmRows={vmRows}
              templateChoices={templateChoices}
              picked={picked}
              onValue={setValue}
              onNetworks={setNetworks}
              onRules={setRules}
              onVms={setVmRows}
              onPick={setPicked}
              ruleNetworks={steps.some((item) => item.id === "networks") ? networks : []}
            />
          </>
        )}
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      {locked ? null : (
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={safeIndex === 0} onClick={() => { setError(""); setIndex(safeIndex - 1) }}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          {safeIndex < steps.length - 1 ? (
            <Button type="button" size="sm" onClick={advance}>Next</Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={sent || reviewContinueError(Boolean(fieldById(fields, "action")), values.action, existingRangeSelected(values.rangeMode)) !== ""}
              onClick={(event) => {
                // A double-click on Next lands the second click here and would send the default.
                if (event.detail > 1) return
                submit()
              }}
            >{sent ? "Sending…" : "Continue"}</Button>
          )}
        </div>
      )}
    </form>
  )
}

function summaryLines(input: {
  fields: LuxaiChoiceField[]
  values: Record<string, string>
  kind: string
  start: string
  hasKind: boolean
  networks: RangeNetworkDraft[]
  vmRows: RangeVmDraft[]
  rules: RangeRuleDraft[]
  extensions: string[]
  roles: Array<{ id: string; label: string }>
}): string[] {
  const lines: string[] = []
  const mode = chosen(input.fields, input.values, "rangeMode") || "new"
  const rangeField = fieldById(input.fields, "rangeMode")
  if (input.hasKind) lines.push(`Config method: ${optionLabel(fieldById(input.fields, "kind"), input.kind)}`)
  if (input.hasKind && input.kind === "ludus") lines.push(`How to start: ${optionLabel(fieldById(input.fields, "start"), input.start)}`)
  lines.push(mode === "new"
    ? `Range: create ${(input.values.rangeId || "").trim() || "…"} (${(input.values.name || "").trim() || "…"})`
    : `Range: ${optionLabel(rangeField, mode)}`)
  if (input.hasKind && input.kind === "ludus" && input.start === "blueprint") {
    lines.push(`Blueprint: ${optionLabel(fieldById(input.fields, "blueprint"), chosen(input.fields, input.values, "blueprint"))}`)
  }
  if (input.hasKind && input.kind === "ludus" && input.start !== "blueprint") {
    lines.push(`Networks: ${input.networks.map((row) => `VLAN ${row.vlan}`).join(", ") || "none"}`)
    if (input.vmRows.some((row) => hostnameIncludesRangeId(row.hostname))) lines.push(RANGE_ID_HOSTNAME_NOTE)
    const domains = input.vmRows
      .filter((row) => row.role === "primary-dc")
      .map((row) => (row.domain || input.values.domain || "").trim())
      .filter(Boolean)
    lines.push(domains.length > 1 ? `Domains: ${domains.join(", ")}` : `Domain: ${domains[0] || (input.values.domain || "").trim() || "none"}`)
    const vms = input.vmRows.map((row) => {
      const role = input.roles.find((item) => item.id === row.role)?.label || row.role
      const joined = row.role === "workstation"
        ? (row.domainJoin ? "joined the domain" : "not domain joined")
        : ""
      const named = row.role === "primary-dc" ? (row.domain || input.values.domain || "").trim() : (row.domain || "").trim()
      const host = hostnameWithoutRangeId(row.hostname.trim()) || "unnamed"
      return `${host} (${role}, ${row.template || "no template"}, VLAN ${row.vlan}${named ? `, ${named}` : ""}${joined ? `, ${joined}` : ""})`
    })
    lines.push(`VMs: ${vms.join("; ") || "none"}`)
    for (const warning of domainJoinWarnings(input.vmRows, input.rules)) lines.push(warning)
  }
  if (fieldById(input.fields, "extensions") && (!input.hasKind || input.kind !== "ludus")) {
    lines.push(`Extensions: ${input.extensions.length > 0 ? input.extensions.join(", ") : "none"}`)
  }
  if (fieldById(input.fields, "rules") && (!input.hasKind || input.kind !== "ludus" || input.start !== "blueprint")) {
    lines.push(input.rules.length > 0 ? `Network rules: ${input.rules.length}` : "Network rules: none")
  }
  const action = fieldById(input.fields, "action")
  if (action && (input.values.action === "create" || input.values.action === "deploy")) {
    lines.push(`When you press Apply: ${applyChoiceLabel(existingRangeSelected(input.values.rangeMode), input.values.action)}`)
  }
  return lines
}

function StepFields({
  step,
  fields,
  values,
  disabled,
  networks,
  rules,
  vmRows,
  templateChoices,
  picked,
  onValue,
  onNetworks,
  onRules,
  onVms,
  onPick,
  ruleNetworks,
}: {
  step: BuildWizardStep
  fields: LuxaiChoiceField[]
  values: Record<string, string>
  disabled: boolean
  networks: RangeNetworkDraft[]
  rules: RangeRuleDraft[]
  vmRows: RangeVmDraft[]
  templateChoices: Array<{ id: string; os: string; built?: boolean }>
  picked: Record<string, boolean>
  onValue: (id: string, value: string) => void
  onNetworks: (rows: RangeNetworkDraft[]) => void
  onRules: (rows: RangeRuleDraft[]) => void
  onVms: (rows: RangeVmDraft[]) => void
  onPick: (value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => void
  ruleNetworks: RangeNetworkDraft[]
}) {
  if (step.id === "type") return <SelectField field={fieldById(fields, "kind")} value={chosen(fields, values, "kind")} disabled={disabled} onValue={onValue} />
  if (step.id === "start") return <SelectField field={fieldById(fields, "start")} value={chosen(fields, values, "start")} disabled={disabled} onValue={onValue} />
  if (step.id === "blueprint") return <SelectField field={fieldById(fields, "blueprint")} value={chosen(fields, values, "blueprint")} disabled={disabled} onValue={onValue} />
  if (step.id === "range") {
    const mode = chosen(fields, values, "rangeMode") || "new"
    return (
      <div className="space-y-3">
        <SelectField field={fieldById(fields, "rangeMode")} value={mode} disabled={disabled} onValue={onValue} />
        {mode === "new" ? (
          <>
            <TextField id="rangeId" label="Range id" value={values.rangeId || ""} placeholder={fieldById(fields, "rangeId")?.placeholder} disabled={disabled} onValue={onValue} />
            <TextField id="name" label="Range name" value={values.name || ""} placeholder={fieldById(fields, "name")?.placeholder} disabled={disabled} onValue={onValue} />
          </>
        ) : null}
      </div>
    )
  }
  if (step.id === "networks") return <NetworkRows rows={networks} disabled={disabled} onChange={onNetworks} />
  if (step.id === "vms") {
    const unbuilt = (fieldById(fields, "vms")?.options ?? []).some((option) => option.disabled)
    return (
      <div className="space-y-2">
        {unbuilt ? <p className="text-sm text-muted-foreground">Templates marked not built cannot be deployed.</p> : null}
        <VmRows
          rows={vmRows}
          roles={fieldById(fields, "vms")?.roles ?? []}
          templates={templateChoices}
          networks={networks}
          disabled={disabled}
          onChange={onVms}
        />
      </div>
    )
  }
  if (step.id === "domain") {
    const primaries = vmRows.filter((row) => row.role === "primary-dc")
    const workstations = vmRows.filter((row) => row.role === "workstation")
    const warnings = domainJoinWarnings(vmRows, rules)
    const patchVm = (index: number, next: Partial<RangeVmDraft>) => {
      onVms(vmRows.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item))
    }
    const domainChoices = primaries.map((row) => (row.domain || (primaries.length === 1 ? values.domain || "" : "")).trim()).filter(Boolean)
    return (
      <div className="space-y-3">
        {primaries.length === 0 ? (
          <TextField id="domain" label="Domain name" value={values.domain || ""} placeholder={fieldById(fields, "domain")?.placeholder} disabled={disabled} onValue={onValue} />
        ) : primaries.map((row) => {
          const at = vmRows.indexOf(row)
          const value = row.domain || (primaries.length === 1 ? values.domain || "" : "")
          return (
            <div key={`domain-${at}`}>
              <Label className="mb-1.5 block" htmlFor={`domain-${at}`}>{row.hostname.trim() || "Domain controller"} domain</Label>
              <Input
                id={`domain-${at}`}
                className="h-10"
                value={value}
                placeholder="meow.local"
                disabled={disabled}
                onChange={(event) => {
                  const domain = event.target.value
                  patchVm(at, { domain })
                  if (primaries.length === 1) onValue("domain", domain)
                }}
              />
            </div>
          )
        })}
        {primaries.length > 1 ? vmRows.map((row, index) => {
          if (row.role === "primary-dc") return null
          const joins = row.role === "workstation" ? row.domainJoin === true : row.role === "alt-dc" || row.role === "member"
          if (!joins) return null
          return (
            <div key={`pick-${index}`}>
              <Label className="mb-1.5 block" htmlFor={`pick-${index}`}>{row.hostname.trim() || "VM"} domain</Label>
              <select
                id={`pick-${index}`}
                className={fieldSelect}
                value={row.domain || ""}
                disabled={disabled}
                onChange={(event) => patchVm(index, { domain: event.target.value })}
              >
                <option value="">Choose a domain</option>
                {domainChoices.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          )
        }) : null}
        {workstations.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Join a workstation to the domain</p>
            <p className="text-xs text-muted-foreground">Leave these off and the workstation stays off the domain.</p>
            {workstations.map((row, index) => {
              const at = vmRows.indexOf(row)
              return (
                <label key={`${row.hostname}-${index}`} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={row.domainJoin === true}
                    disabled={disabled}
                    onCheckedChange={(value) => onVms(vmRows.map((item, itemIndex) => itemIndex === at ? { ...item, domainJoin: value === true } : item))}
                  />
                  <span>
                    <span className="font-medium">{row.hostname.trim() || `Workstation ${index + 1}`}</span>
                    <span className="block text-xs text-muted-foreground">VLAN {row.vlan || "…"}</span>
                  </span>
                </label>
              )
            })}
          </div>
        ) : null}
        {warnings.map((warning) => (
          <p key={warning} className="text-sm text-status-warning">{warning}</p>
        ))}
      </div>
    )
  }
  if (step.id === "extensions") {
    const options = fieldById(fields, "extensions")?.options ?? []
    if (options.length === 0) return <p className="text-sm text-muted-foreground">None are available.</p>
    return (
      <div className="space-y-2">
        {options.map((option) => (
          <label key={option.id} className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={picked[option.id] === true}
              disabled={disabled || option.disabled === true}
              onCheckedChange={(value) => onPick((current) => ({ ...current, [option.id]: value === true }))}
            />
            <span>
              <span className="font-medium">{option.label}</span>
              {option.detail ? <span className="block text-xs text-muted-foreground">{option.detail}</span> : null}
            </span>
          </label>
        ))}
      </div>
    )
  }
  if (step.id === "rules") {
    const warnings = domainJoinWarnings(vmRows, rules)
    return (
      <div className="space-y-3">
        <FirewallRules rows={rules} networks={ruleNetworks} disabled={disabled} onChange={onRules} />
        {warnings.map((warning) => (
          <p key={warning} className="text-sm text-status-warning">{warning}</p>
        ))}
      </div>
    )
  }
  if (step.id === "review") {
    const action = fieldById(fields, "action")
    if (!action) return null
    const picked = values.action || ""
    return (
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1.5 text-sm font-medium">{action.label}</legend>
        {(["create", "deploy"] as const).map((id) => (
          <label key={id} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={action.id}
              className="mt-1 h-4 w-4 accent-primary"
              checked={picked === id}
              onChange={() => onValue(action.id, id)}
            />
            <span className="font-medium">{applyChoiceLabel(existingRangeSelected(values.rangeMode), id)}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  return null
}

function SelectField({
  field,
  value,
  disabled,
  onValue,
}: {
  field: LuxaiChoiceField | undefined
  value: string
  disabled: boolean
  onValue: (id: string, value: string) => void
}) {
  if (!field) return null
  return (
    <div>
      <Label className="mb-1.5 block">{field.label}</Label>
      <select className={fieldSelect} value={value} disabled={disabled} onChange={(event) => onValue(field.id, event.target.value)}>
        {(field.options ?? []).map((option) => (
          <option key={option.id} value={option.id} disabled={option.disabled === true}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  placeholder,
  disabled,
  onValue,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  disabled: boolean
  onValue: (id: string, value: string) => void
}) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <Input value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onValue(id, event.target.value)} />
    </div>
  )
}
