"use client"

import { Check, CircleAlert, PackageX } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function TemplateChips({
  required,
  builtNames,
  allNames,
}: {
  required: string[]
  builtNames: Set<string>
  allNames: Set<string>
}) {
  if (required.length === 0) return null
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {required.map((t) => {
          const built = builtNames.has(t)
          const installed = allNames.has(t)
          const chip = (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border",
                built
                  ? "bg-status-success/10 border-status-success/30 text-status-success"
                  : installed
                  ? "bg-yellow-500/10 border-yellow-500/30 text-status-warning"
                  : "bg-status-error/10 border-status-error/30 text-status-error"
              )}
            >
              {built
                ? <Check className="h-2.5 w-2.5 flex-shrink-0" />
                : installed
                ? <CircleAlert className="h-2.5 w-2.5 flex-shrink-0" />
                : <PackageX className="h-2.5 w-2.5 flex-shrink-0" />}
              {t}
            </span>
          )
          if (built) {
            return (
              <Tooltip key={t}>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="border-status-success/30 bg-green-950/90 text-green-300 text-xs px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-status-success flex-shrink-0" />
                    <span><span className="font-mono font-semibold">{t}</span> — installed &amp; built</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          }
          return (
            <span
              key={t}
              title={installed ? "Installed but not yet built — go to Templates to build" : "Not installed — go to Templates to add"}
            >
              {chip}
            </span>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
