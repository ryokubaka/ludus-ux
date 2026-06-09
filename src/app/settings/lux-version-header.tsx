import { LuxVersionBadge } from "@/components/layout/lux-version-badge"

/** Cached semver — server-rendered for settings About chrome. */
export function LuxVersionHeader() {
  return (
    <LuxVersionBadge className="text-xs text-muted-foreground font-mono tabular-nums" />
  )
}
