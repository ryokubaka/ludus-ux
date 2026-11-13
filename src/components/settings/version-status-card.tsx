"use client"

import type { ReactNode } from "react"
import { AlertTriangle, ArrowRight, BadgeCheck, Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/core/utils"

export type VersionStatusState = "loading" | "current" | "update" | "unknown" | "working"

export function VersionStatusCard({
  product,
  state,
  current,
  latest,
  detail,
  action,
}: {
  product: string
  state: VersionStatusState
  current?: string
  latest?: string | null
  detail?: string
  action?: ReactNode
}) {
  const tone =
    state === "update"
      ? "border-status-warning/50 bg-status-warning/10"
      : state === "current"
        ? "border-status-success/40 bg-status-success/10"
        : state === "working"
          ? "border-status-info/40 bg-status-info/10"
          : "border-border bg-card"
  const iconWrap =
    state === "update"
      ? "bg-status-warning/20 text-status-warning"
      : state === "current"
        ? "bg-status-success/20 text-status-success"
        : state === "working"
          ? "bg-status-info/20 text-status-info"
          : "bg-muted text-muted-foreground"
  const Icon =
    state === "update" ? Sparkles : state === "current" ? BadgeCheck : state === "unknown" ? AlertTriangle : Loader2
  const title =
    state === "update"
      ? "Update available"
      : state === "current"
        ? "Up to date"
        : state === "working"
          ? "Updating"
          : state === "loading"
            ? "Checking"
            : "Could not check"
  const body =
    state === "current"
      ? `${product} ${current || ""} is the latest release.`.replace(/\s{2,}/g, " ")
      : state === "loading"
        ? `Looking for a newer ${product} release.`
        : detail || "The release list did not load."

  return (
    <div className={cn("flex h-full min-h-[4.75rem] items-center gap-3 rounded-lg border px-4 py-3", tone)}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", iconWrap)}>
        <Icon className={cn("h-5 w-5", (state === "loading" || state === "working") && "animate-spin")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {state === "update" ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{current || "—"}</span>
            <ArrowRight className="h-3.5 w-3.5 text-status-warning" />
            <span className="font-mono text-foreground">{latest}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
        )}
      </div>
      {action}
    </div>
  )
}
