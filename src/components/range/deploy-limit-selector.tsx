"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ludusApi } from "@/lib/api"
import {
  limitHostsFromRangeVms,
  parseHostsFromRangeConfig,
} from "@/lib/ludus-deploy-limit"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { Filter, Loader2, RefreshCw } from "lucide-react"

export type DeployLimitHostSource = "config" | "range"

export interface DeployLimitSelectorProps {
  rangeId: string
  configYaml: string
  selectedHosts: string[]
  onSelectedHostsChange: (hosts: string[]) => void
  customPattern: string
  onCustomPatternChange: (pattern: string) => void
  disabled?: boolean
}

export function DeployLimitSelector({
  rangeId,
  configYaml,
  selectedHosts,
  onSelectedHostsChange,
  customPattern,
  onCustomPatternChange,
  disabled,
}: DeployLimitSelectorProps) {
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [showCustom, setShowCustom] = useState(false)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [hostSource, setHostSource] = useState<DeployLimitHostSource>("config")
  const [availableHosts, setAvailableHosts] = useState<string[]>([])

  const configHosts = useMemo(
    () => parseHostsFromRangeConfig(configYaml, rangeId),
    [configYaml, rangeId],
  )

  useEffect(() => {
    setAvailableHosts(configHosts)
    setHostSource("config")
    setSearch("")
  }, [rangeId, configHosts])

  const filteredHosts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return availableHosts
    return availableHosts.filter((h) => h.toLowerCase().includes(q))
  }, [availableHosts, search])

  const toggleHost = (host: string) => {
    onSelectedHostsChange(
      selectedHosts.includes(host)
        ? selectedHosts.filter((h) => h !== host)
        : [...selectedHosts, host],
    )
  }

  const handleRefreshFromRange = async () => {
    setRangeLoading(true)
    try {
      const result = await ludusApi.getRangeStatus(rangeId)
      if (result.error) {
        toast({
          variant: "destructive",
          title: "Range lookup failed",
          description: result.error,
        })
        return
      }
      const vms = result.data?.VMs ?? []
      const rangeHosts = limitHostsFromRangeVms(vms, configYaml, rangeId)
      if (rangeHosts.length === 0) {
        toast({
          variant: "destructive",
          title: "No deployed VMs",
          description: "Range has no VMs yet. Using hostnames from config YAML.",
        })
        setAvailableHosts(configHosts)
        setHostSource("config")
        return
      }
      setAvailableHosts(rangeHosts)
      setHostSource("range")
      onSelectedHostsChange(selectedHosts.filter((h) => rangeHosts.includes(h)))
      toast({
        title: "Hosts synced",
        description: `${rangeHosts.length} deployed VM${rangeHosts.length !== 1 ? "s" : ""} (Ansible hostnames from config).`,
      })
    } finally {
      setRangeLoading(false)
    }
  }

  const sourceLabel =
    hostSource === "range"
      ? `Showing ${availableHosts.length} host${availableHosts.length !== 1 ? "s" : ""} from deployed VMs (GET /range)`
      : `Showing ${availableHosts.length} host${availableHosts.length !== 1 ? "s" : ""} from range config`

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Filter className="h-4 w-4" />
          Deploy Host Limit
          <span className="text-xs text-muted-foreground font-normal">
            (leave empty for all hosts — Ludus CLI{" "}
            <code className="text-[11px] text-primary/90">--limit</code>)
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          Limits which hosts Ansible runs against. Combinable with deploy tags (tags = steps, limit = hosts).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search hosts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 max-w-xs text-sm"
            disabled={disabled || availableHosts.length === 0}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleRefreshFromRange()}
            disabled={disabled || rangeLoading || !rangeId}
          >
            {rangeLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync deployed VMs
          </Button>
          {selectedHosts.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onSelectedHostsChange([])}
              disabled={disabled}
            >
              Clear selection
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">{sourceLabel}</p>

        {availableHosts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No hosts found in config. Add VMs to range-config.yml or sync after first deploy.
          </p>
        ) : filteredHosts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No hosts match your search.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
            {filteredHosts.map((host) => (
              <label
                key={host}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                  selectedHosts.includes(host)
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50",
                )}
              >
                <Checkbox
                  checked={selectedHosts.includes(host)}
                  onCheckedChange={() => toggleHost(host)}
                  disabled={disabled || !!customPattern.trim()}
                  className="shrink-0"
                />
                <code className="text-xs font-mono text-primary truncate" title={host}>
                  {host}
                </code>
              </label>
            ))}
          </div>
        )}

        <div className="pt-1 border-t border-border/50 space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="deploy-limit-custom-toggle"
              checked={showCustom}
              onCheckedChange={(v) => setShowCustom(v === true)}
              disabled={disabled}
            />
            <Label
              htmlFor="deploy-limit-custom-toggle"
              className="text-xs text-muted-foreground font-normal cursor-pointer"
            >
              Custom Ansible limit pattern
            </Label>
          </div>
          {showCustom && (
            <>
              <Input
                placeholder="e.g. windows or host1:host2"
                value={customPattern}
                onChange={(e) => onCustomPatternChange(e.target.value)}
                className="h-8 font-mono text-xs"
                disabled={disabled}
              />
              <p className="text-[11px] text-muted-foreground">
                When set, overrides checkbox selection (groups, globs, comma-separated hosts).
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
