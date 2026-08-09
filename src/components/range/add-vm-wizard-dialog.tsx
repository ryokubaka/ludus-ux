"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { ludusApi } from "@/lib/api"
import { extractArray } from "@/lib/utils"
import type { TemplateObject } from "@/lib/types"
import {
  appendVmsToRangeConfig,
  defaultVlanFromConfig,
  defaultsForTemplate,
  inferOS,
  suggestIpLastOctetForVlan,
  type VMEntry,
} from "@/lib/range-vm-wizard"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Plus,
  Loader2,
  Server,
  Trash2,
  Settings2,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
} from "lucide-react"

export interface AddVmWizardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  configYaml: string
  rangeId: string
  rangeNumber?: number
  onApply: (mergedYaml: string, addedCount: number) => void
}

export function AddVmWizardDialog({
  open,
  onOpenChange,
  configYaml,
  rangeId,
  rangeNumber,
  onApply,
}: AddVmWizardDialogProps) {
  const scopeTag = useEffectiveScopeTag()
  const [vms, setVms] = useState<VMEntry[]>([])
  const [rangeVlan, setRangeVlan] = useState(10)

  useEffect(() => {
    if (!open) return
    setVms([])
    setRangeVlan(defaultVlanFromConfig(configYaml))
  }, [open, configYaml])

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: queryKeys.templates(scopeTag),
    queryFn: async () => {
      const result = await ludusApi.listTemplates()
      return extractArray<TemplateObject>(result.data as unknown).filter((t) => t.built)
    },
    staleTime: STALE.long,
    enabled: open,
  })

  const displayRangeNumber = rangeNumber ?? "?"

  const addVM = useCallback(
    (template: string) => {
      setVms((prev) => {
        const vlan = rangeVlan
        const pending = new Set(prev.filter((v) => v.vlan === vlan).map((v) => v.ipLastOctet))
        const ipLastOctet = suggestIpLastOctetForVlan(configYaml, vlan, pending)
        return [...prev, defaultsForTemplate(template, { vlan, ipLastOctet })]
      })
    },
    [configYaml, rangeVlan],
  )

  const removeVM = useCallback((id: string) => {
    setVms((prev) => prev.filter((v) => v.id !== id))
  }, [])

  const updateVM = useCallback((id: string, patch: Partial<VMEntry>) => {
    setVms((prev) =>
      prev.map((v) => {
        if (v.id !== id) return v
        const updated = { ...v, ...patch }
        if ("hostname" in patch) {
          updated.vmName = `{{ range_id }}-${patch.hostname ?? ""}`
        }
        return updated
      }),
    )
  }, [])

  const handleRangeVlanChange = useCallback((vlan: number) => {
    setRangeVlan(vlan)
    setVms((prev) =>
      prev.map((v, i) => ({
        ...v,
        vlan,
        ipLastOctet: suggestIpLastOctetForVlan(
          configYaml,
          vlan,
          new Set(prev.filter((x, j) => j !== i && x.vlan === vlan).map((x) => x.ipLastOctet)),
        ),
      })),
    )
  }, [configYaml])

  const handleApply = () => {
    if (vms.length === 0) return
    const merged = appendVmsToRangeConfig(configYaml, vms)
    onApply(merged, vms.length)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add VMs to range</DialogTitle>
          <DialogDescription>
            Pick built templates and tune hostname, VLAN, and resources. New entries append to{" "}
            <code className="font-mono text-primary">{rangeId}</code>&apos;s{" "}
            <code className="font-mono">ludus:</code> list — review YAML, then Save Config.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Built templates</CardTitle>
            </CardHeader>
            <CardContent>
              {templatesLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No built templates.{" "}
                  <Link href="/templates" className="text-primary underline">
                    Build templates
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {templates.map((t) => {
                    const { isLinux, isWindows } = inferOS(t.name)
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => addVM(t.name)}
                        className="flex items-center gap-2 p-2 rounded border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-left"
                      >
                        <Plus className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-mono truncate">{t.name}</p>
                          <Badge variant="secondary" className="text-[10px]">
                            {isWindows ? "Windows" : isLinux ? "Linux" : "Other"}
                          </Badge>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {vms.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <HardDrive className="h-4 w-4" />
                    VMs to add
                    <Badge variant="secondary">{vms.length}</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Network className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Default VLAN</Label>
                    <Input
                      type="number"
                      value={rangeVlan}
                      min={2}
                      max={255}
                      onChange={(e) => handleRangeVlanChange(parseInt(e.target.value) || 10)}
                      className="h-7 w-20 text-xs text-center font-mono"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 max-h-72 overflow-y-auto">
                {vms.map((vm) => (
                  <div key={vm.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Server className="h-4 w-4 text-primary shrink-0" />
                      <code className="text-xs font-mono font-medium flex-1 truncate min-w-[120px]">
                        {vm.template}
                      </code>
                      <div className="flex gap-1 items-center text-xs text-muted-foreground">
                        <Cpu className="h-3 w-3" /> {vm.cpus}
                        <span className="mx-1">|</span>
                        <MemoryStick className="h-3 w-3" /> {vm.ramGb}GB
                        <span className="mx-1">|</span>
                        <span className="font-mono">
                          10.{displayRangeNumber}.{vm.vlan}.{vm.ipLastOctet}
                        </span>
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        type="button"
                        onClick={() => updateVM(vm.id, { showAdvanced: !vm.showAdvanced })}
                      >
                        <Settings2 className="h-3 w-3" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" type="button" onClick={() => removeVM(vm.id)}>
                        <Trash2 className="h-3 w-3 text-status-error" />
                      </Button>
                    </div>
                    {vm.showAdvanced && (
                      <div className="pt-2 border-t space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2 space-y-1">
                            <Label className="text-[10px]">
                              Hostname
                              {vm.isWindows && (
                                <span className="text-muted-foreground ml-1">(max 15 chars)</span>
                              )}
                            </Label>
                            <Input
                              value={vm.hostname}
                              onChange={(e) =>
                                updateVM(vm.id, {
                                  hostname: e.target.value.slice(0, vm.isWindows ? 15 : 63),
                                })
                              }
                              maxLength={vm.isWindows ? 15 : 63}
                              className="h-7 text-xs font-mono"
                              placeholder="server-01"
                            />
                            <Label className="text-[10px] text-muted-foreground">VM Name (Proxmox)</Label>
                            <Input
                              value={vm.vmName}
                              readOnly
                              className="h-7 text-xs font-mono bg-muted/30 text-muted-foreground cursor-default"
                              tabIndex={-1}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">IP last octet</Label>
                            <Input
                              type="number"
                              value={vm.ipLastOctet}
                              min={1}
                              max={254}
                              onChange={(e) =>
                                updateVM(vm.id, { ipLastOctet: parseInt(e.target.value) || 10 })
                              }
                              className="h-7 text-xs"
                            />
                            <Label className="text-[10px]">VLAN</Label>
                            <Input
                              type="number"
                              value={vm.vlan}
                              min={2}
                              max={255}
                              onChange={(e) => {
                                const vlan = parseInt(e.target.value) || 10
                                const pending = new Set(
                                  vms
                                    .filter((x) => x.id !== vm.id && x.vlan === vlan)
                                    .map((x) => x.ipLastOctet),
                                )
                                const octet = suggestIpLastOctetForVlan(configYaml, vlan, pending)
                                updateVM(vm.id, { vlan, ipLastOctet: octet })
                              }}
                              className="h-7 text-xs"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px]">CPUs</Label>
                            <Input
                              type="number"
                              value={vm.cpus}
                              min={1}
                              max={32}
                              onChange={(e) => updateVM(vm.id, { cpus: parseInt(e.target.value) || 2 })}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">RAM (GB)</Label>
                            <Input
                              type="number"
                              value={vm.ramGb}
                              min={1}
                              max={128}
                              onChange={(e) => updateVM(vm.id, { ramGb: parseInt(e.target.value) || 4 })}
                              className="h-7 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={vms.length === 0} onClick={handleApply}>
            Add {vms.length > 0 ? `${vms.length} ` : ""}VM{vms.length !== 1 ? "s" : ""} to config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
