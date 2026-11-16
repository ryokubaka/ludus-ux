"use client"

import { Check, Loader2, Puzzle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/core/utils"
import type { GoadExtensionDef, GoadLabDef } from "@/lib/core/types"
import {
  compatibleGoadExtensions,
  goadExtensionChoiceState,
  goadLabChoiceState,
  type GoadPickReadiness,
} from "./goad-lab-choice"

export interface GoadLabPick {
  labs: GoadLabDef[]
  extensions: GoadExtensionDef[]
  loading: boolean
  error: string | null
  selectedLab: string | null
  selectedExtensions: readonly string[]
  readiness: GoadPickReadiness
  onSelectLab: (name: string) => void
  onToggleExtension: (name: string) => void
  onRetry: () => void
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

export function GoadLabPicker({ pick }: { pick: GoadLabPick }) {
  const readiness = pick.readiness
  const extensions = compatibleGoadExtensions(pick.selectedLab, pick.extensions)

  return (
    <div className="space-y-4 border-b border-border p-3">
      <div>
        <SectionLabel>GOAD labs</SectionLabel>
        {pick.loading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading labs…
          </div>
        ) : pick.error ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{pick.error}</p>
            <Button type="button" size="sm" variant="outline" className="h-7 w-full text-[10px]" onClick={pick.onRetry}>
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        ) : pick.labs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No GOAD labs on this host.</p>
        ) : (
          <div className="space-y-1.5" role="listbox" aria-label="GOAD labs">
            {pick.labs.map((lab) => {
              const state = goadLabChoiceState(lab, readiness)
              const selected = pick.selectedLab === lab.name
              return (
                <button
                  key={lab.name}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={!state.selectable}
                  title={state.reason ?? lab.description}
                  onClick={() => pick.onSelectLab(lab.name)}
                  className={cn(
                    "w-full rounded-md border px-2.5 py-2 text-left text-xs shadow-sm",
                    selected
                      ? "border-primary bg-primary/10"
                      : state.selectable
                        ? "border-border bg-card hover:border-primary/50"
                        : "cursor-not-allowed border-dashed border-border bg-muted/30 opacity-70",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <code className="truncate font-mono text-primary">{lab.name}</code>
                    {selected && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-primary" />}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lab.vmCount} VMs
                    {lab.domains > 0 ? ` · ${lab.domains} domain${lab.domains === 1 ? "" : "s"}` : ""}
                    {state.reason ? ` · ${state.reason}` : ""}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Extensions
          </span>
        </div>
        {!pick.selectedLab ? (
          <p className="text-xs text-muted-foreground">Select a lab to see the extensions that install into it.</p>
        ) : extensions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No extensions for this lab.</p>
        ) : (
          <div className="space-y-1.5">
            {extensions.map((ext) => (
              <ExtensionRow
                key={ext.name}
                ext={ext}
                readiness={readiness}
                checked={pick.selectedExtensions.includes(ext.name)}
                onToggle={() => pick.onToggleExtension(ext.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ExtensionRow({
  ext,
  readiness,
  checked,
  onToggle,
}: {
  ext: GoadExtensionDef
  readiness: GoadPickReadiness
  checked: boolean
  onToggle: () => void
}) {
  const state = goadExtensionChoiceState(ext, readiness)
  const machines = Array.isArray(ext.machines) ? ext.machines : []
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 text-xs shadow-sm",
        !state.selectable && "border-dashed border-border bg-muted/30 opacity-70",
        state.selectable && checked && "border-primary bg-primary/5",
        state.selectable && !checked && "border-border bg-card",
      )}
    >
      <label className={cn("flex items-start gap-2", state.selectable ? "cursor-pointer" : "cursor-not-allowed")}>
        <Checkbox
          checked={checked}
          disabled={!state.selectable}
          onCheckedChange={() => state.selectable && onToggle()}
          className="mt-0.5"
          aria-label={ext.name}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <code className="truncate font-mono text-primary">{ext.name}</code>
            {machines.length > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">+{machines.length} VM</span>
            )}
          </span>
          {typeof ext.description === "string" && ext.description && (
            <span className="mt-0.5 block text-[10px] text-muted-foreground">{ext.description}</span>
          )}
          {state.reason && <span className="mt-0.5 block text-[10px] text-muted-foreground">{state.reason}</span>}
        </span>
      </label>
    </div>
  )
}
