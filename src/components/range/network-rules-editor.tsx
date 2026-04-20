"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2, ChevronDown, ChevronRight, Info, Shield, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type NetworkRule,
  type VlanValue,
  type Protocol,
  type RuleAction,
  blankRule,
} from "@/lib/network-rules"

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: RuleAction }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-xs",
        action === "ACCEPT" && "border-green-500 text-green-400",
        action === "REJECT" && "border-red-500 text-red-400",
        action === "DROP" && "border-orange-500 text-orange-400"
      )}
    >
      {action}
    </Badge>
  )
}

function VlanDisplay({ vlan }: { vlan: VlanValue }) {
  if (typeof vlan === "number") return <span className="font-mono text-primary">VLAN {vlan}</span>
  return <span className="font-mono text-yellow-400">{vlan}</span>
}

/** Human-readable label for a VlanValue */
function vlanLabel(v: VlanValue): string {
  return typeof v === "number" ? `VLAN ${v}` : v
}

/** Parse a dropdown item string back to a VlanValue */
function parseVlan(v: string): VlanValue {
  const lower = v.trim().toLowerCase()
  if (lower === "wireguard" || lower === "public" || lower === "all") return lower
  const n = parseInt(v, 10)
  return isNaN(n) ? "all" : n
}

// ── VLAN select ───────────────────────────────────────────────────────────────

interface VlanSelectProps {
  value: VlanValue
  onChange: (v: VlanValue) => void
  availableVlans: number[]
}

function VlanSelect({ value, onChange, availableVlans }: VlanSelectProps) {
  const isCustomNum = typeof value === "number" && !availableVlans.includes(value)
  const [showCustomInput, setShowCustomInput] = useState(isCustomNum)
  const [inputStr, setInputStr] = useState(isCustomNum ? String(value) : "")

  // Value used only for dropdown item highlight (not for trigger display)
  const selectValue = isCustomNum ? "__custom__" : String(value)

  // What we show in the trigger button
  const triggerText = showCustomInput
    ? inputStr ? `VLAN ${inputStr}` : "Custom…"
    : vlanLabel(value)

  return (
    <div className="space-y-1.5">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === "__custom__") {
            setInputStr(isCustomNum ? String(value) : "")
            setShowCustomInput(true)
          } else {
            setShowCustomInput(false)
            setInputStr("")
            onChange(parseVlan(v))
          }
        }}
      >
        <SelectTrigger className="h-8 text-sm font-mono text-center">
          {/* Bypass SelectValue so we fully control the trigger label */}
          <span className="flex-1 text-center">{triggerText}</span>
        </SelectTrigger>
        <SelectContent>
          {availableVlans.length > 0 && (
            <>
              <SelectGroup>
                <SelectLabel className="text-xs">Range VLANs</SelectLabel>
                {availableVlans.map((vlan) => (
                  <SelectItem key={vlan} value={String(vlan)}>
                    VLAN {vlan}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
            </>
          )}
          <SelectGroup>
            <SelectLabel className="text-xs">Special</SelectLabel>
            <SelectItem value="wireguard">wireguard</SelectItem>
            <SelectItem value="public">public</SelectItem>
            <SelectItem value="all">all</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value="__custom__">Custom number…</SelectItem>
        </SelectContent>
      </Select>

      {(isCustomNum || showCustomInput) && (
        <Input
          value={showCustomInput ? inputStr : String(value)}
          onChange={(e) => {
            const str = e.target.value
            setInputStr(str)
            const n = parseInt(str, 10)
            if (!isNaN(n) && n >= 1 && n <= 255) onChange(n)
          }}
          onBlur={() => {
            const n = parseInt(inputStr, 10)
            if (!isNaN(n) && n >= 1 && n <= 255) setShowCustomInput(false)
          }}
          placeholder="VLAN number (1–255)"
          className="h-7 text-xs font-mono text-center"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={showCustomInput && !isCustomNum}
        />
      )}
    </div>
  )
}

// ── Rule row editor ───────────────────────────────────────────────────────────

interface RuleEditorProps {
  rule: NetworkRule
  index: number
  expanded: boolean
  onToggle: () => void
  onChange: (updated: NetworkRule) => void
  onDelete: () => void
  isDragOver: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  availableVlans: number[]
}

function RuleRow({
  rule, index, expanded, onToggle, onChange, onDelete,
  isDragOver, onDragStart, onDragOver, onDragLeave, onDrop,
  availableVlans,
}: RuleEditorProps) {
  const update = (patch: Partial<NetworkRule>) => onChange({ ...rule, ...patch })

  return (
    <div
      className={cn(
        "border border-border rounded-md overflow-hidden transition-colors",
        isDragOver && "border-primary bg-primary/5"
      )}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Collapsed summary row */}
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors select-none"
        onClick={onToggle}
      >
        <GripVertical
          className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        />
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <span className="text-xs text-muted-foreground w-5 flex-shrink-0">#{index + 1}</span>
        <span className="flex-1 text-sm truncate min-w-0">
          {rule.name || <span className="text-muted-foreground italic">Unnamed rule</span>}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-muted-foreground">
          <VlanDisplay vlan={rule.vlan_src} />
          <span>→</span>
          <VlanDisplay vlan={rule.vlan_dst} />
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono">
            {rule.protocol === "all" ? "all" : `${rule.protocol}/${rule.ports}`}
          </span>
        </div>
        <ActionBadge action={rule.action} />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Expanded edit form */}
      {expanded && (
        <div className="border-t border-border bg-muted/20 p-3 space-y-3">
          {/* Name */}
          <div className="space-y-1">
            <Label className="text-xs">Rule name</Label>
            <Input
              value={rule.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Allow all traffic from VLAN 10 to wireguard"
              className="h-8 text-sm"
            />
          </div>

          {/* Source / destination VLANs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Source VLAN</Label>
              <VlanSelect
                value={rule.vlan_src}
                onChange={(v) => update({ vlan_src: v })}
                availableVlans={availableVlans}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Destination VLAN</Label>
              <VlanSelect
                value={rule.vlan_dst}
                onChange={(v) => update({ vlan_dst: v })}
                availableVlans={availableVlans}
              />
            </div>
          </div>

          {/* Optional IP octets */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Source IP last octet{" "}
                <span className="text-muted-foreground font-normal">(optional; empty = all)</span>
              </Label>
              <Input
                value={rule.ip_last_octet_src ?? ""}
                onChange={(e) =>
                  update({ ip_last_octet_src: e.target.value || undefined })
                }
                placeholder="Single or range; e.g., 21 or 21-25"
                className="h-8 text-sm font-mono text-center"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Destination IP last octet{" "}
                <span className="text-muted-foreground font-normal">(optional; empty = all)</span>
              </Label>
              <Input
                value={rule.ip_last_octet_dst ?? ""}
                onChange={(e) =>
                  update({ ip_last_octet_dst: e.target.value || undefined })
                }
                placeholder="Single or range; e.g., 31 or 31-35"
                className="h-8 text-sm font-mono text-center"
              />
            </div>
          </div>

          {/* Protocol / ports / action */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Protocol</Label>
              <Select
                value={rule.protocol}
                onValueChange={(v) => {
                  const proto = v as Protocol
                  update({ protocol: proto, ports: proto === "all" ? "all" : rule.ports })
                }}
              >
                <SelectTrigger className="h-8 text-sm text-center font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="tcp">tcp</SelectItem>
                  <SelectItem value="udp">udp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className={cn("text-xs", rule.protocol === "all" && "text-muted-foreground/50")}>
                Ports
              </Label>
              <Input
                value={rule.protocol === "all" ? "" : rule.ports}
                onChange={(e) => update({ ports: e.target.value })}
                placeholder={rule.protocol === "all" ? "N/A" : "all / 443 / 8080:8088"}
                disabled={rule.protocol === "all"}
                className="h-8 text-sm font-mono text-center disabled:opacity-40"
              />
              <p className="text-[10px] text-muted-foreground text-center">
                {rule.protocol === "all"
                  ? "requires tcp or udp"
                  : "all · single · start:end"}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Action</Label>
              <Select
                value={rule.action}
                onValueChange={(v) => update({ action: v as RuleAction })}
              >
                <SelectTrigger className="h-8 text-sm text-center font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACCEPT">ACCEPT</SelectItem>
                  <SelectItem value="REJECT">REJECT</SelectItem>
                  <SelectItem value="DROP">DROP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface NetworkRulesEditorProps {
  rules: NetworkRule[]
  onChange: (rules: NetworkRule[]) => void
  /** VLAN numbers currently in use in this range config — populates the VLAN dropdowns. */
  availableVlans?: number[]
  /** If true, show an "Apply to Config" button instead of inline apply behaviour */
  showApplyButton?: boolean
  onApply?: () => void
}

export function NetworkRulesEditor({
  rules,
  onChange,
  availableVlans = [],
  showApplyButton,
  onApply,
}: NetworkRulesEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragIndexRef = useRef<number | null>(null)

  const addRule = () => {
    const newRules = [...rules, blankRule()]
    onChange(newRules)
    setExpandedIndex(newRules.length - 1)
  }

  const updateRule = (index: number, updated: NetworkRule) => {
    const newRules = rules.map((r, i) => (i === index ? updated : r))
    onChange(newRules)
  }

  const deleteRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index))
    if (expandedIndex === index) setExpandedIndex(null)
    else if (expandedIndex !== null && expandedIndex > index)
      setExpandedIndex(expandedIndex - 1)
  }

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index)
  }

  // ── Drag-and-drop handlers ────────────────────────────────────────────────
  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    dragIndexRef.current = index
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDragLeave = () => setDragOverIndex(null)

  const handleDrop = (dropIndex: number) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverIndex(null)
    const from = dragIndexRef.current
    dragIndexRef.current = null
    if (from === null || from === dropIndex) return
    const reordered = [...rules]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(dropIndex, 0, moved)
    if (expandedIndex === from) setExpandedIndex(dropIndex)
    else if (expandedIndex !== null) {
      const lo = Math.min(from, dropIndex)
      const hi = Math.max(from, dropIndex)
      if (expandedIndex >= lo && expandedIndex <= hi) {
        setExpandedIndex(from < dropIndex ? expandedIndex - 1 : expandedIndex + 1)
      }
    }
    onChange(reordered)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="h-4 w-4 flex-shrink-0 text-foreground/60" />
        <span>
          Rules are evaluated <strong className="text-foreground/80">top-to-bottom</strong> (iptables order). Drag rows to reorder.
          Rules are applied to the range-config.yml in reverse order.{" "}
          <a
            href="https://docs.ludus.cloud/docs/infrastructure-operations/networking/"
            target="_blank"
            rel="noreferrer"
            className="underline text-primary hover:text-primary/80"
          >
            Ludus networking docs ↗
          </a>
        </span>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 border border-dashed border-border rounded-md text-muted-foreground gap-2">
          <Shield className="h-8 w-8 opacity-30" />
          <p className="text-sm">No custom firewall rules — Ludus defaults apply.</p>
          <p className="text-xs">
            Default: all inter-VLAN and external traffic is{" "}
            <span className="text-green-400 font-mono">ACCEPT</span>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, index) => (
            <RuleRow
              key={index}
              rule={rule}
              index={index}
              expanded={expandedIndex === index}
              onToggle={() => toggleExpand(index)}
              onChange={(updated) => updateRule(index, updated)}
              onDelete={() => deleteRule(index)}
              isDragOver={dragOverIndex === index}
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(index)}
              availableVlans={availableVlans}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addRule}>
          <Plus className="h-4 w-4" />
          Add Rule
        </Button>
        {showApplyButton && onApply && rules.length > 0 && (
          <Button variant="default" size="sm" onClick={onApply}>
            Apply to Config
          </Button>
        )}
      </div>
    </div>
  )
}
