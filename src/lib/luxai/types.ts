/** Shared LUXAI shapes. This file stays free of server imports so the page can use it. */

export type LuxaiProvider = "openai" | "anthropic" | "cursor"
export type LuxaiEgress = "local" | "cloud"

export interface LuxaiModelParameter {
  id: string
  displayName: string
  values: Array<{ value: string; displayName: string }>
}

export interface LuxaiModelVariant {
  displayName: string
  params: Array<{ id: string; value: string }>
  isDefault?: boolean
}

export interface LuxaiModelInfo {
  id: string
  displayName: string
  parameters: LuxaiModelParameter[]
  variants?: LuxaiModelVariant[]
}

export interface LuxaiPublicSettings {
  enabled: boolean
  ready: boolean
  provider: LuxaiProvider
  egress: LuxaiEgress
  baseUrl: string
  model: string
  apiKeySet: boolean
  effort: string
  contextWindow: number
  modelParams: Array<{ id: string; value: string }>
  catalog: LuxaiModelInfo[]
  maxRounds: number
  maxToolCalls: number
  timeoutSec: number
  systemPrompt: string
  promptIsDefault: boolean
  canConfigure: boolean
}

export interface LuxaiSessionSummary {
  id: string
  title: string
  updatedAt: number
  archived: boolean
  /** Latest run on this chat, when one exists. */
  runStatus: "running" | "paused" | "done" | "stopped" | null
}

export interface LuxaiMessageView {
  id: string
  role: "user" | "assistant"
  content: string
  reasoning?: string
  createdAt: number
}

export type LuxaiChangeKind = "range_config" | "power" | "deploy" | "guest_command" | "goad_deploy" | "range_create" | "range_delete"

export interface LuxaiChoiceField {
  id: string
  label: string
  kind: "text" | "select" | "check" | "vms" | "networks" | "rules"
  placeholder?: string
  options?: LuxaiChoiceOption[]
  /** Role choices for a `vms` field. `detail` is the OS those templates must match. */
  roles?: LuxaiChoiceOption[]
  /** Hide this field unless every rule matches the current form. */
  showWhen?: Array<{ field: string; equals?: string; notEquals?: string }>
  /** Hide this field when every rule matches. */
  hideWhen?: Array<{ field: string; equals?: string; notEquals?: string }>
}

export interface LuxaiChoiceOption {
  id: string
  label: string
  detail?: string
}

/** A checklist the operator answers while a run is still in progress. */
export interface LuxaiChoice {
  id: string
  prompt: string
  multiple: boolean
  options: LuxaiChoiceOption[]
  /** When set, the form is these fields. `options` stays for a checklist-only question. */
  fields?: LuxaiChoiceField[]
}
export type LuxaiChangeStatus = "pending" | "applying" | "applied" | "reverted" | "rejected"

export interface LuxaiChangeView {
  id: string
  sessionId: string
  rangeId: string
  kind: LuxaiChangeKind
  status: LuxaiChangeStatus
  summary: string
  preview: string
  /** Full range config when this proposal creates or replaces one. The operator can edit it before Apply. */
  yaml?: string
  revertable: boolean
  createdAt: number
}

export type LuxaiStreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "run"; runId: string }
  | { type: "tool"; name: string; ok: boolean }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "steer"; text: string }
  | { type: "choice"; choice: LuxaiChoice }
  | { type: "pending"; change: LuxaiChangeView }
  | { type: "done"; text: string }
  | { type: "error"; error: string }
