/** Tab classification for Ludus range deploy vs GOAD-terminal-only actions. */
export const DEPLOY_TAB_ACTIONS = new Set(["provide", "install", "install-extension", "provision-lab"])
export const TERMINAL_TAB_ACTIONS = new Set(["provision-extension"])

export const GOAD_INSTANCE_TAB_IDS = new Set([
  "deploy",
  "terminal",
  "info",
  "inventories",
  "extensions",
  "history",
])

export function formatTaskInstant(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatDuration(startedAt: number, endedAt?: number): string {
  const ms = (endedAt ?? Date.now()) - startedAt
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Legacy / mistaken query values → a real `TabsTrigger` value (`logs` had no trigger). */
export function normalizeGoadInstanceTab(tab: string): string {
  if (tab === "logs") return "deploy"
  if (GOAD_INSTANCE_TAB_IDS.has(tab)) return tab
  return "deploy"
}

/** First paint: URL ?tab= wins (normalized); otherwise default to "deploy". */
export function readInitialGoadTab(): string {
  if (typeof window === "undefined") return "deploy"
  try {
    const raw = new URLSearchParams(window.location.search).get("tab")
    if (raw) return normalizeGoadInstanceTab(raw)
  } catch {
    /* ignore */
  }
  return "deploy"
}

/**
 * True when a GOAD command string corresponds to a deploy-class action (one
 * that triggers a Ludus range deploy and should land on the Deploy Status tab).
 */
export function isDeployActionCommand(command: string): boolean {
  return /;\s*(provide|install|install_extension|provision_lab)\b/.test(command)
}

export function checkTemplates(
  required: string[],
  builtNames: Set<string>,
  allNames: Set<string>,
): {
  present: string[]
  missingUnbuilt: string[]
  missingAbsent: string[]
  ready: boolean
} {
  const present: string[] = []
  const missingUnbuilt: string[] = []
  const missingAbsent: string[] = []
  for (const t of required) {
    if (builtNames.has(t)) present.push(t)
    else if (allNames.has(t)) missingUnbuilt.push(t)
    else missingAbsent.push(t)
  }
  return { present, missingUnbuilt, missingAbsent, ready: missingUnbuilt.length === 0 && missingAbsent.length === 0 }
}
