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

export function getRangeStateBadge(state: string): string {
  switch (state) {
    case "SUCCESS":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "DEPLOYING":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "ERROR":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "ABORTED":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}
