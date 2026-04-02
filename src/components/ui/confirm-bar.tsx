"use client"

import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface ConfirmBarProps {
  pending: { label: string; fn: () => void } | null
  onConfirm: () => void
  onCancel: () => void
  /** Extra Tailwind classes applied to the outer wrapper */
  className?: string
}

/**
 * Inline confirmation bar.  Renders nothing when `pending` is null.
 *
 * Drop this just above (or below) any group of action buttons and pass the
 * `pendingAction` / `commitConfirm` / `cancelConfirm` values from
 * `useConfirm()`.
 */
export function ConfirmBar({ pending, onConfirm, onCancel, className }: ConfirmBarProps) {
  if (!pending) return null

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-md border border-yellow-500/40",
        "bg-yellow-500/10 px-3 py-2",
        className ?? "",
      ].join(" ")}
    >
      <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0" />
      <span className="text-xs text-yellow-300 flex-1">{pending.label}</span>
      <Button size="sm" variant="default" onClick={onConfirm}>
        Confirm
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
