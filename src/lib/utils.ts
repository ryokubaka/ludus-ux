import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";
import { getAnsibleLineClass } from "./ansible-colors";

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

export function formatRelativeTime(date: string | Date | undefined): string {
  if (!date) return "Never";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return String(date);
  }
}

export function getRangeStateColor(state: string): string {
  switch (state) {
    case "SUCCESS":
      return "text-green-400";
    case "DEPLOYING":
      return "text-yellow-400";
    case "ERROR":
      return "text-red-400";
    case "ABORTED":
      return "text-orange-400";
    case "NEVER DEPLOYED":
      return "text-gray-400";
    default:
      return "text-gray-400";
  }
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

export function getPowerStateColor(state: string): string {
  switch (state) {
    case "running":
      return "text-green-400";
    case "stopped":
      return "text-red-400";
    case "suspended":
      return "text-yellow-400";
    default:
      return "text-gray-400";
  }
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

export function parseLogLine(raw: string): {
  level?: string;
  message: string;
  color: string;
} {
  return { message: raw, color: getAnsibleLineClass(raw) };
}

