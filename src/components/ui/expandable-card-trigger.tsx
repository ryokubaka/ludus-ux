"use client"

import type { LucideIcon } from "lucide-react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ExpandableCardTriggerProps {
  open: boolean
  onToggle: () => void
  icon?: LucideIcon
  title: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}

/** Accordion row with vertically centered content (CardHeader flex-col misaligns these). */
export function ExpandableCardTrigger({
  open,
  onToggle,
  icon: Icon,
  title,
  subtitle,
  trailing,
  className,
}: ExpandableCardTriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/20 transition-colors",
        className,
      )}
      onClick={onToggle}
    >
      {open ? (
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
      <span className="text-sm font-semibold leading-none">{title}</span>
      {subtitle && (
        <span className="text-xs text-muted-foreground font-normal leading-none truncate">
          {subtitle}
        </span>
      )}
      {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
    </button>
  )
}
