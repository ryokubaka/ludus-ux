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
import { useState } from "react"
import { previewSlice, ShowAllBar } from "@/components/ui/show-all-bar"

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

  const [showAllTags, setShowAllTags] = useState(false)
  const collapsedHelper = "Full deploy. Expand to limit steps or roles."
  const tagsBoxHelper = "Empty runs every step."
  const onlyRolesBoxHelper = "Empty runs every role."

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
          <p className="text-xs text-muted-foreground pl-5">{collapsedHelper}</p>
        )}
        {expanded && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div>
                <h4 className="text-xs font-medium flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  Deploy tags
                </h4>
                <p className="text-xs text-muted-foreground mt-1">{tagsBoxHelper}</p>
              </div>
              <div className="rounded-md border border-border">
              <div className="grid grid-cols-2 gap-1.5 p-2">
                {previewSlice([...LUDUS_DEPLOY_TAGS], showAllTags).map((tag) => (
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
                      <p className="text-xs text-muted-foreground truncate">
                        {LUDUS_DEPLOY_TAG_DESCRIPTIONS[tag] || ""}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
              <ShowAllBar expanded={showAllTags} count={LUDUS_DEPLOY_TAGS.length} onToggle={() => setShowAllTags((v) => !v)} />
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
                <p className="text-xs text-muted-foreground mt-1">{onlyRolesBoxHelper}</p>
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
