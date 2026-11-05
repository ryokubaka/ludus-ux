"use client"

import { useState } from "react"

interface PendingAction {
  label: string
  fn: () => void
  /**
   * Optional scope key. When set, <ConfirmBar scope={key} /> renders inline
   * next to the triggering row instead of the page-level bar at the top.
   * Leave undefined for page-global actions (unscoped).
   */
  key?: string
}

/**
 * Lightweight inline confirmation pattern.
 *
 * Usage (global / unscoped):
 *   const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
 *   confirm("Power off all VMs?", () => handlePowerOff())
 *   <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
 *
 * Usage (scoped — prompt renders next to a specific list row):
 *   confirm(`Install "${ext}"?`, () => doInstall(ext), `install:${ext}`)
 *   // Inside the row:
 *   <ConfirmBar
 *     pending={pendingAction}
 *     scope={`install:${ext}`}
 *     onConfirm={commitConfirm}
 *     onCancel={cancelConfirm}
 *   />
 *
 * A ConfirmBar with `scope` set only renders when `pendingAction.key === scope`.
 * A ConfirmBar with no `scope` prop only renders for unscoped pending actions,
 * so the global bar and per-row bars never both appear for the same action.
 */
export function useConfirm() {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const confirm = (label: string, fn: () => void, key?: string) =>
    setPendingAction({ label, fn, key })

  const cancelConfirm = () => setPendingAction(null)

  const commitConfirm = () => {
    if (!pendingAction) return
    const fn = pendingAction.fn
    setPendingAction(null)
    fn()
  }

  return { pendingAction, confirm, cancelConfirm, commitConfirm }
}
