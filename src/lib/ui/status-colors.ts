/**
 * Semantic status colors — backed by --status-* tokens in globals.css.
 * Prefer these over raw Tailwind palette classes (green-400, red-400, etc.).
 */

export type StatusKind = "success" | "warning" | "error" | "aborted" | "neutral" | "info"

export function statusText(kind: StatusKind): string {
  return `text-status-${kind}`
}

export function statusBadge(kind: StatusKind): string {
  return `bg-status-${kind}/20 text-status-${kind} border-status-${kind}/30`
}

export function statusSurface(kind: StatusKind): string {
  return `border-status-${kind}/30 bg-status-${kind}/10 ${statusText(kind)}`
}

export function statusIcon(kind: StatusKind): string {
  return statusText(kind)
}
