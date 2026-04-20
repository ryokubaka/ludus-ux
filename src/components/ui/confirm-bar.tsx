"use client"

import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface ConfirmBarProps {
  pending: { label: string; fn: () => void; key?: string } | null
  onConfirm: () => void
  onCancel: () => void
  /** Extra Tailwind classes applied to the outer wrapper */
  className?: string
  /**
   * Scope filter. When set, this bar only renders when `pending.key === scope`,
   * enabling inline per-row confirmations. When omitted, only unscoped
   * pending actions render (the global / page-level bar).
   */
  scope?: string
}

/**
 * Inline confirmation bar.  Renders nothing when `pending` is null or when
 * the scope doesn't match (see `scope` prop).
 *
 * Drop this just above (or below) any group of action buttons and pass the
 * `pendingAction` / `commitConfirm` / `cancelConfirm` values from
 * `useConfirm()`. For per-row confirmations pass `scope="<same key you used in confirm()>"`.
 */
export function ConfirmBar({ pending, onConfirm, onCancel, className, scope }: ConfirmBarProps) {
  if (!pending) return null
  // Scope gating: a scoped bar only shows when the pending action matches;
  // an unscoped (global) bar only shows when the pending action is unscoped,
  // so we never render two bars for the same confirmation.
  if (scope !== undefined) {
    if (pending.key !== scope) return null
  } else if (pending.key !== undefined) {
    return null
  }

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
