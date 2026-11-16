"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/core/utils"
import { installedReleaseRowClass } from "@/components/settings/version-log"

export function ReleaseRow({
  installed,
  open,
  onToggle,
  label,
  actions,
  notes,
  children,
}: {
  installed: boolean
  open: boolean
  onToggle: () => void
  label: string
  actions?: ReactNode
  notes?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={cn("relative", installedReleaseRowClass(installed))}>
      {installed && <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />}
      <div className="relative">
        <button
          type="button"
          className="absolute inset-0 cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          aria-expanded={open}
          aria-label={label}
          onClick={onToggle}
        />
        <div className="pointer-events-none relative z-10 flex items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            {children}
          </div>
          {actions && (
            <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
              {actions}
            </div>
          )}
        </div>
      </div>
      {open && notes ? <div className="px-4 pb-3">{notes}</div> : null}
    </div>
  )
}
