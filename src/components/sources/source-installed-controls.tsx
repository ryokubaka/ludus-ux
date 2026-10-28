"use client"

import { useState } from "react"
import Link from "next/link"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import {
  formatVersionTransition,
  isMissingOrUnknownVersion,
  normalizeCatalogVersion,
} from "@/lib/source-catalog-presence"
import type { InstalledSourceMatch } from "@/lib/source-installed-match"
import { postSourceInstall } from "@/lib/source-install-client"

/** Repo origin link for content matched to a registered Ludus source. */
export function SourceRepoLink({ match }: { match: InstalledSourceMatch }) {
  const label = match.sourceLabel
  if (match.sourceUrl) {
    return (
      <a
        href={match.sourceUrl.replace(/\.git$/, "")}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline max-w-[14rem]"
        title={match.sourceUrl}
      >
        <span className="truncate">{label}</span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
      </a>
    )
  }
  return (
    <Link
      href="/sources"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      title="Open Sources"
    >
      <span className="truncate max-w-[14rem]">{label}</span>
    </Link>
  )
}

/** Prefer installed version; fall back to catalog when inventory has none. */
export function displayInstalledVersion(
  installedVersion?: string | null,
  catalogVersion?: string | null,
): string {
  if (!isMissingOrUnknownVersion(installedVersion)) {
    return normalizeCatalogVersion(installedVersion) || installedVersion!.trim()
  }
  const catalog = normalizeCatalogVersion(catalogVersion)
  if (catalog) return catalog
  return "—"
}

/**
 * Sync status tile + Re-sync for source-matched installed items.
 * Always offers Re-sync; badge reflects in-sync vs update available.
 */
export function SourceSyncControls({
  match,
  onResynced,
}: {
  match: InstalledSourceMatch
  onResynced?: () => void
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const transition = formatVersionTransition(match.installedVersion, match.catalogVersion)
  const outOfSync = match.upgradeAvailable

  const handleResync = async () => {
    setBusy(true)
    try {
      await postSourceInstall(match.sourceId, match.selection, { force: true })
      toast({ title: "Re-synced", description: match.catalogName })
      onResynced?.()
    } catch (err) {
      toast({ variant: "destructive", title: "Re-sync failed", description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      <Badge
        variant={outOfSync ? "warning" : "success"}
        className="text-[10px]"
        title={
          outOfSync
            ? transition || "Catalog version differs from installed (or installed version unknown)"
            : "Installed version matches source catalog"
        }
      >
        {outOfSync ? "Out of sync" : "In sync"}
      </Badge>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[10px]"
        disabled={busy}
        title="Overwrite installed content from the source catalog"
        onClick={() => void handleResync()}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        Re-sync
      </Button>
    </div>
  )
}

/** @deprecated Use SourceSyncControls — kept as alias for existing imports. */
export function SourceUpdateControls(props: {
  match: InstalledSourceMatch
  onResynced?: () => void
}) {
  return <SourceSyncControls {...props} />
}
