"use client"

import { useState } from "react"

interface PendingAction {
  label: string
  fn: () => void
}

/**
 * Lightweight inline confirmation pattern.
 *
 * Usage:
 *   const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
 *
 *   // Trigger a confirmation
 *   confirm("Power off all VMs?", () => handlePowerOff())
 *
 *   // Render the bar anywhere above the action buttons:
 *   <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
 */
export function useConfirm() {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const confirm = (label: string, fn: () => void) =>
    setPendingAction({ label, fn })

  const cancelConfirm = () => setPendingAction(null)

  const commitConfirm = () => {
    if (!pendingAction) return
    const fn = pendingAction.fn
    setPendingAction(null)
    fn()
  }

  return { pendingAction, confirm, cancelConfirm, commitConfirm }
}
