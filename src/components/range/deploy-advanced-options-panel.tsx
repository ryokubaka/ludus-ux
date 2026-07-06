"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { DeployOnlyRolesSelector } from "@/components/range/deploy-only-roles-selector"
import { LUDUS_DEPLOY_TAGS, LUDUS_DEPLOY_TAG_DESCRIPTIONS } from "@/lib/ludus-deploy-tags"
import { resolveDeployOnlyRoles } from "@/lib/ludus-deploy-only-roles"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp, ListChecks, Tag } from "lucide-react"

export interface DeployAdvancedOptionsPanelProps {
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  onClearTags: () => void
  configYaml: string
  selectedOnlyRoles: string[]
  onSelectedOnlyRolesChange: (roles: string[]) => void
  customOnlyRolesPattern: string
  onCustomOnlyRolesPatternChange: (pattern: string) => void
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** `direct` = single range deploy; `goad` = injected on every deploy in GOAD session */
  helperContext?: "direct" | "goad"
  /** When set, filter tags for badge display (GOAD allowlist). Omit for direct Ludus deploy. */
  displayTags?: string[]
}

export function DeployAdvancedOptionsPanel({
  selectedTags,
  onToggleTag,
  onClearTags,
  configYaml,
  selectedOnlyRoles,
  onSelectedOnlyRolesChange,
  customOnlyRolesPattern,
  onCustomOnlyRolesPatternChange,
  expanded,
  onExpandedChange,
  helperContext = "direct",
  displayTags,
}: DeployAdvancedOptionsPanelProps) {
  const tagBadges = displayTags ?? selectedTags
  const onlyRolesResolved = resolveDeployOnlyRoles(selectedOnlyRoles, customOnlyRolesPattern)
  const hasTagSelection = tagBadges.length > 0
  const hasOnlyRoles = !!onlyRolesResolved?.length

  const collapsedHelper =
    helperContext === "goad"
      ? (
          <>
            Full Ludus Ansible (no <code className="text-primary">--tags</code> or{" "}
            <code className="text-primary">--only-roles</code> filter). Expand to limit deploy steps or Ansible roles.
          </>
        )
      : (
          <>
            Full Ludus Ansible deploy. Expand to limit Ansible <strong>steps</strong> (tags) or{" "}
            <strong>roles</strong> (<code className="text-primary">--only-roles</code>) before deploying.
          </>
        )

  const tagsBoxHelper =
    helperContext === "goad"
      ? (
          <>
            Pass <code className="text-primary">--tags</code> to every{" "}
            <code className="text-primary">ludus range deploy</code> in this GOAD session. Limits which Ansible{" "}
            <strong>steps</strong> run — leave empty for all steps. Tight sets can break domain or extension plays.
          </>
        )
      : (
          <>
            Limits which Ansible <strong>steps</strong> run (Ludus CLI{" "}
            <code className="text-primary">--tags</code>). Leave empty for a full step set — recommended for first-time deploys.
          </>
        )

  const onlyRolesBoxHelper =
    helperContext === "goad"
      ? (
          <>
            Pass <code className="text-primary">--only-roles</code> on each deploy in this GOAD session.{" "}
            <strong>Only the selected roles run</strong> — all other roles in the config are skipped. Leave empty to run every role. The{" "}
            <code className="text-primary">user-defined-roles</code> tag is added automatically.
          </>
        )
      : (
          <>
            Limits which Ansible <strong>roles</strong> run (Ludus CLI{" "}
            <code className="text-primary">--only-roles</code>).{" "}
            <strong>Only selected roles execute</strong> — other roles in range-config are skipped. Leave empty to run all roles. The{" "}
            <code className="text-primary">user-defined-roles</code> tag is added automatically.
          </>
        )

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 gap-y-1">
          <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">Deploy options</span>
          {hasTagSelection && (
            <div className="flex flex-wrap gap-1 min-w-0">
              {tagBadges.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs font-mono">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {hasOnlyRoles && (
            <div className="flex flex-wrap gap-1 min-w-0">
              {onlyRolesResolved!.map((r) => (
                <Badge key={r} variant="outline" className="text-xs font-mono">
                  only: {r}
                </Badge>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto gap-1 h-7 text-xs shrink-0"
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {expanded ? "Hide deploy options" : "Advanced deploy options"}
          </Button>
        </div>
        {!expanded && !hasTagSelection && !hasOnlyRoles && (
          <p className="text-[10px] text-muted-foreground pl-5">{collapsedHelper}</p>
        )}
        {expanded && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div>
                <h4 className="text-xs font-medium flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  Deploy tags
                </h4>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{tagsBoxHelper}</p>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-[22rem] overflow-y-auto pr-1">
                {LUDUS_DEPLOY_TAGS.map((tag) => (
                  <label
                    key={tag}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded border text-left transition-colors cursor-pointer",
                      selectedTags.includes(tag)
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <Checkbox
                      checked={selectedTags.includes(tag)}
                      onCheckedChange={() => onToggleTag(tag)}
                      className="shrink-0"
                    />
                    <div className="min-w-0">
                      <code className="text-xs font-mono text-primary">{tag}</code>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {LUDUS_DEPLOY_TAG_DESCRIPTIONS[tag] || ""}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <div className="flex items-center justify-between pt-1 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    {selectedTags.length} tag{selectedTags.length !== 1 ? "s" : ""} selected
                  </p>
                  <Button size="sm" variant="ghost" onClick={onClearTags}>
                    Clear all
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div>
                <h4 className="text-xs font-medium flex items-center gap-1.5">
                  <ListChecks className="h-3.5 w-3.5 text-primary" />
                  Only roles
                </h4>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{onlyRolesBoxHelper}</p>
              </div>
              <DeployOnlyRolesSelector
                configYaml={configYaml}
                selectedRoles={selectedOnlyRoles}
                onSelectedRolesChange={onSelectedOnlyRolesChange}
                customPattern={customOnlyRolesPattern}
                onCustomPatternChange={onCustomOnlyRolesPatternChange}
                compact
                hideAutoTagNote
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
