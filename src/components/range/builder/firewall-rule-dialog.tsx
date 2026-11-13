"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  displayHostAddress,
  isHostAddress,
  normalizeIpLastOctet,
  type NetworkRule,
  type Protocol,
  type RuleAction,
  type VlanValue,
} from "@/lib/range/network-rules"

function vlanLabel(value: VlanValue): string {
  return typeof value === "number" ? `VLAN ${value}` : value
}

function parseVlan(value: string): VlanValue {
  if (value === "wireguard" || value === "public" || value === "all") return value
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : "all"
}

function vlanChoices(current: VlanValue, vlans: readonly number[]): VlanValue[] {
  const numbers = [...new Set([...vlans, ...(typeof current === "number" ? [current] : [])])].sort((a, b) => a - b)
  const specials: VlanValue[] = ["wireguard", "public"]
  if (current === "all") specials.push("all")
  return [...numbers, ...specials]
}

function endpointSummary(vlan: VlanValue, address: string): string {
  return address ? `${vlanLabel(vlan)} (${address})` : `${vlanLabel(vlan)} (whole subnet)`
}

export function FirewallRuleDialog({
  rule,
  vlans,
  rangeNumber,
  onOpenChange,
  onSave,
}: {
  rule: NetworkRule | null
  vlans: readonly number[]
  rangeNumber: number | null
  onOpenChange: (open: boolean) => void
  onSave: (rule: NetworkRule) => void
}) {
  const [draft, setDraft] = useState<NetworkRule | null>(rule)
  const [srcIp, setSrcIp] = useState("")
  const [dstIp, setDstIp] = useState("")
  const [formError, setFormError] = useState("")
  useEffect(() => {
    setDraft(rule)
    setSrcIp(rule ? displayHostAddress(rule.vlan_src, rule.ip_last_octet_src, rangeNumber) : "")
    setDstIp(rule ? displayHostAddress(rule.vlan_dst, rule.ip_last_octet_dst, rangeNumber) : "")
    setFormError("")
  }, [rangeNumber, rule])

  const save = () => {
    if (!draft) return
    if (draft.protocol !== "all" && !draft.ports.trim()) {
      setFormError("Enter a port, a list, or a range.")
      return
    }
    if (!isHostAddress(srcIp) || !isHostAddress(dstIp)) {
      setFormError("Use a last octet, a range such as 21-25, or a full address. Leave it blank for the whole subnet.")
      return
    }
    onSave({
      ...draft,
      name: draft.name.trim() || `${vlanLabel(draft.vlan_src)} to ${vlanLabel(draft.vlan_dst)}`,
      ports: draft.protocol === "all" ? "all" : draft.ports.trim(),
      ip_last_octet_src: normalizeIpLastOctet(srcIp),
      ip_last_octet_dst: normalizeIpLastOctet(dstIp),
    })
  }

  return (
    <Dialog open={rule != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Firewall rule</DialogTitle>
          <DialogDescription>
            {draft
              ? `${endpointSummary(draft.vlan_src, srcIp)} to ${endpointSummary(draft.vlan_dst, dstIp)}. The line is added when you save.`
              : "Choose what this line allows."}
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Rule name</span>
              <Input
                className="h-8 text-sm"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <VlanField
                label="Source VLAN"
                value={draft.vlan_src}
                vlans={vlans}
                onChange={(vlan) => setDraft({ ...draft, vlan_src: vlan })}
              />
              <VlanField
                label="Destination VLAN"
                value={draft.vlan_dst}
                vlans={vlans}
                onChange={(vlan) => setDraft({ ...draft, vlan_dst: vlan })}
              />
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Source IP</span>
                <Input
                  className="h-8 text-xs font-mono"
                  value={srcIp}
                  placeholder="Whole subnet"
                  onChange={(event) => {
                    setSrcIp(event.target.value)
                    setFormError("")
                  }}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Destination IP</span>
                <Input
                  className="h-8 text-xs font-mono"
                  value={dstIp}
                  placeholder="Whole subnet"
                  onChange={(event) => {
                    setDstIp(event.target.value)
                    setFormError("")
                  }}
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Protocol</span>
                <Select
                  value={draft.protocol}
                  onValueChange={(value) => {
                    const protocol = value as Protocol
                    setDraft({
                      ...draft,
                      protocol,
                      ports: protocol === "all" ? "all" : draft.ports === "all" ? "" : draft.ports,
                    })
                    setFormError("")
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">all</SelectItem>
                    <SelectItem value="tcp" className="text-xs">tcp</SelectItem>
                    <SelectItem value="udp" className="text-xs">udp</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Ports</span>
                <Input
                  className="h-8 text-xs font-mono"
                  value={draft.protocol === "all" ? "" : draft.ports}
                  disabled={draft.protocol === "all"}
                  placeholder={draft.protocol === "all" ? "all" : "443"}
                  onChange={(event) => {
                    setDraft({ ...draft, ports: event.target.value })
                    setFormError("")
                  }}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Action</span>
                <Select
                  value={draft.action}
                  onValueChange={(value) => setDraft({ ...draft, action: value as RuleAction })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACCEPT" className="text-xs">ACCEPT</SelectItem>
                    <SelectItem value="REJECT" className="text-xs">REJECT</SelectItem>
                    <SelectItem value="DROP" className="text-xs">DROP</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            {formError && <p className="text-[11px] text-destructive">{formError}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!draft}>
            Add rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VlanField({
  label,
  value,
  vlans,
  onChange,
}: {
  label: string
  value: VlanValue
  vlans: readonly number[]
  onChange: (vlan: VlanValue) => void
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Select value={String(value)} onValueChange={(next) => onChange(parseVlan(next))}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {vlanChoices(value, vlans).map((choice) => (
            <SelectItem key={String(choice)} value={String(choice)} className="text-xs">
              {vlanLabel(choice)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
