import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | undefined): string {
  if (!date) return "Never";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    return format(d, "MMM dd, yyyy HH:mm");
  } catch {
    return String(date);
  }
}

/**
 * Humanised "X ago" with graceful fallback for older timestamps.
 * Accepts an ISO/parseable date string, epoch millis, or a Date.
 * Returns the input stringified if the date can't be parsed so callers
 * never have to guard against NaN.
 */
export function timeAgo(input: string | number | Date): string {
  const ms = input instanceof Date ? input.getTime() : typeof input === "number" ? input : new Date(input).getTime()
  if (!Number.isFinite(ms)) return String(input)
  const diff = Date.now() - ms
  if (diff < 0) return String(input)
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Format elapsed milliseconds as a compact human-readable string.
 * e.g. 0 → "0s", 90_000 → "1m 30s", 3_720_000 → "1h 2m"
 */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * Unwrap `[...]` or `{ result: [...] }` shapes returned by Ludus endpoints
 * (legacy responses wrap the payload in `{ result }`, newer ones return the
 * array directly). Returns `[]` for anything that can't be coerced.
 */
export function extractArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === "object" && "result" in data) {
    const r = (data as { result: unknown }).result
    if (Array.isArray(r)) return r as T[]
  }
  return []
}

/** Ludus group list — array, `{ result }`, `{ groups }`, `{ items }`, or single row. */
export function parseLudusGroupList<T extends object>(data: unknown): T[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as T[]
  if (typeof data === "object" && data !== null) {
    if ("result" in data) {
      const inner = (data as { result: unknown }).result
      if (Array.isArray(inner)) return inner as T[]
      if (inner && typeof inner === "object") return [inner as T]
      return []
    }
    if ("groups" in data && Array.isArray((data as { groups: unknown }).groups)) {
      return (data as { groups: T[] }).groups
    }
    if ("items" in data && Array.isArray((data as { items: unknown }).items)) {
      return (data as { items: T[] }).items
    }
  }
  return []
}

export function getRangeStateBadge(state: string): string {
  switch (state) {
    case "SUCCESS":
      return "bg-status-success/20 text-status-success border-status-success/30";
    case "DEPLOYING":
      return "bg-status-warning/20 text-status-warning border-status-warning/30";
    case "ERROR":
      return "bg-status-error/20 text-status-error border-status-error/30";
    case "ABORTED":
      return "bg-status-aborted/20 text-status-aborted border-status-aborted/30";
    default:
      return "bg-status-neutral/20 text-status-neutral border-status-neutral/30";
  }
}
