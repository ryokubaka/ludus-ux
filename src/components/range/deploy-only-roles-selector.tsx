"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseSelectableDeployOnlyRoles } from "@/lib/ludus-deploy-only-roles"
import { cn } from "@/lib/utils"
import { ListChecks } from "lucide-react"

export interface DeployOnlyRolesSelectorProps {
  configYaml: string
  selectedRoles: string[]
  onSelectedRolesChange: (roles: string[]) => void
  customPattern: string
  onCustomPatternChange: (pattern: string) => void
  disabled?: boolean
  /** Omit outer Card — embed in wizard / GOAD advanced panels */
  compact?: boolean
  /** Hide footer auto-tag note when parent section explains it */
  hideAutoTagNote?: boolean
}

export function DeployOnlyRolesSelector({
  configYaml,
  selectedRoles,
  onSelectedRolesChange,
  customPattern,
  onCustomPatternChange,
  disabled,
  compact,
  hideAutoTagNote,
}: DeployOnlyRolesSelectorProps) {
  const [search, setSearch] = useState("")
  const [showCustom, setShowCustom] = useState(false)

  const availableRoles = useMemo(
    () => parseSelectableDeployOnlyRoles(configYaml),
    [configYaml],
  )

  useEffect(() => {
    setSearch("")
  }, [configYaml])

  useEffect(() => {
    if (selectedRoles.length === 0) return
    const allowed = new Set(availableRoles)
    const pruned = selectedRoles.filter((r) => allowed.has(r))
    if (pruned.length !== selectedRoles.length) {
      onSelectedRolesChange(pruned)
    }
  }, [availableRoles, selectedRoles, onSelectedRolesChange])

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return availableRoles
    return availableRoles.filter((r) => r.toLowerCase().includes(q))
  }, [availableRoles, search])

  const toggleRole = (role: string) => {
    onSelectedRolesChange(
      selectedRoles.includes(role)
        ? selectedRoles.filter((r) => r !== role)
        : [...selectedRoles, role],
    )
  }

  const body = (
    <div className={cn("space-y-3", compact ? "" : "")}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search roles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs text-sm"
          disabled={disabled || availableRoles.length === 0}
        />
        {selectedRoles.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onSelectedRolesChange([])}
            disabled={disabled}
          >
            Clear selection
          </Button>
        )}
      </div>

      {availableRoles.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No Ansible roles found in config. Add roles to range-config.yml first.
        </p>
      ) : filteredRoles.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No roles match your search.</p>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 md:grid-cols-2 gap-2 overflow-y-auto pr-1",
            compact ? "max-h-48" : "max-h-64",
          )}
        >
          {filteredRoles.map((role) => (
            <label
              key={role}
              className={cn(
                "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                selectedRoles.includes(role)
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50",
              )}
            >
              <Checkbox
                checked={selectedRoles.includes(role)}
                onCheckedChange={() => toggleRole(role)}
                disabled={disabled || !!customPattern.trim()}
                className="shrink-0"
              />
              <code className="text-xs font-mono text-primary truncate" title={role}>
                {role}
              </code>
            </label>
          ))}
        </div>
      )}

      <div className="pt-1 border-t border-border/50 space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="deploy-only-roles-custom-toggle"
            checked={showCustom}
            onCheckedChange={(v) => setShowCustom(v === true)}
            disabled={disabled}
          />
          <Label
            htmlFor="deploy-only-roles-custom-toggle"
            className="text-xs text-muted-foreground font-normal cursor-pointer"
          >
            Custom comma-separated roles
          </Label>
        </div>
        {showCustom && (
          <>
            <Input
              placeholder="e.g. badsectorlabs.ludus_elastic_agent"
              value={customPattern}
              onChange={(e) => onCustomPatternChange(e.target.value)}
              className="h-8 font-mono text-xs"
              disabled={disabled}
            />
            <p className="text-[11px] text-muted-foreground">
              When set, overrides checkbox selection.
            </p>
          </>
        )}
      </div>

      {!hideAutoTagNote && (
        <p className="text-[11px] text-muted-foreground">
          <code className="text-[11px] text-primary/90">user-defined-roles</code> tag added automatically
          when roles are selected.
        </p>
      )}
    </div>
  )

  if (compact) {
    return body
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Deploy Only Roles
          <span className="text-xs text-muted-foreground font-normal">
            (leave empty for all roles — Ludus CLI{" "}
            <code className="text-[11px] text-primary/90">--only-roles</code>)
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          Limits which Ansible roles run during deploy. Combinable with deploy tags and host limit.
          Requires the <code className="text-[11px] text-primary/90">user-defined-roles</code> tag
          (added automatically).
        </p>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
