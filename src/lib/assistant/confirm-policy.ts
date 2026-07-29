/**
 * Destructive-tool confirmation policy for the in-app assistant.
 * Modes mirror Claude Code-style approvals: once / allow this op / allow all.
 */

import type { PendingDestructiveCall } from "@/lib/assistant/assistant-config"

export type AssistantConfirmMode = "once" | "allow_op" | "allow_all"

export interface AssistantConfirmPolicy {
  /** Skip confirmation for all destructive Ludus/LUX tool calls in this conversation. */
  allowAll: boolean
  /** Keys from {@link confirmOpKey} that are allowlisted for this conversation. */
  allowOps: string[]
}

export function emptyConfirmPolicy(): AssistantConfirmPolicy {
  return { allowAll: false, allowOps: [] }
}

export function parseConfirmPolicy(raw: unknown): AssistantConfirmPolicy {
  if (!raw || typeof raw !== "object") return emptyConfirmPolicy()
  const o = raw as { allowAll?: unknown; allowOps?: unknown }
  const allowOps = Array.isArray(o.allowOps)
    ? o.allowOps.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 200)
    : []
  return {
    allowAll: o.allowAll === true,
    allowOps: [...new Set(allowOps)].slice(0, 200),
  }
}

/** Stable allowlist key: surface + METHOD + path (operationId can drift across OpenAPI enrich). */
export function confirmOpKey(
  surface: "ludus" | "lux",
  method: string,
  path: string,
): string {
  return `${surface}:${method.toLowerCase()}:${path}`
}

export function confirmOpKeyFromPending(pending: PendingDestructiveCall): string {
  return confirmOpKey(pending.surface, pending.method, pending.path)
}

export function policyAllowsOp(
  policy: AssistantConfirmPolicy | null | undefined,
  surface: "ludus" | "lux",
  method: string,
  path: string,
): boolean {
  if (!policy) return false
  if (policy.allowAll) return true
  const key = confirmOpKey(surface, method, path)
  return policy.allowOps.includes(key)
}

export function applyConfirmMode(
  policy: AssistantConfirmPolicy,
  mode: AssistantConfirmMode,
  pending: PendingDestructiveCall,
): AssistantConfirmPolicy {
  if (mode === "once") return policy
  if (mode === "allow_all") return { allowAll: true, allowOps: policy.allowOps }
  const key = confirmOpKeyFromPending(pending)
  if (policy.allowOps.includes(key)) return policy
  return { ...policy, allowOps: [...policy.allowOps, key] }
}

/** Token authorizes this pending call when surface/method/path match (operationId soft). */
export function pendingMatchesOp(
  pending: PendingDestructiveCall | null,
  surface: "ludus" | "lux",
  method: string,
  path: string,
): boolean {
  if (!pending) return false
  if (pending.surface !== surface) return false
  if (pending.method.toLowerCase() !== method.toLowerCase()) return false
  if (pending.path !== path) return false
  return true
}
