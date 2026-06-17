import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export const LUDUS_SOURCES_DOCS_URL = "https://docs.ludus.cloud/docs/using-ludus/sources/"

export function SourceCatalogBanner({
  catalogSource,
  registeredSourceId,
  sourcesAvailable,
}: {
  catalogSource?: "ludus" | "github" | null
  registeredSourceId?: string | null
  sourcesAvailable?: boolean
}) {
  if (catalogSource === "ludus") {
    return (
      <div className="text-xs rounded-md border border-primary/30 bg-primary/5 px-3 py-2 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">Ludus Sources catalog</Badge>
          {registeredSourceId && (
            <code className="font-mono text-primary text-[11px]">{registeredSourceId}</code>
          )}
        </div>
        <p className="text-muted-foreground">
          Loaded from a registered Ludus source (synced catalog, not a raw Git tree).{" "}
          <Link href="/sources" className="text-primary hover:underline">
            Manage sources
          </Link>
          {" · "}
          <a
            href={LUDUS_SOURCES_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            Documentation
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    )
  }

  if (sourcesAvailable === false) {
    return (
      <p className="text-xs text-muted-foreground">
        Catalog fetched from the Git repository tree. Upgrade Ludus to 2.2.0+ to use the Sources API for
        richer metadata and centralized source management —{" "}
        <a
          href={LUDUS_SOURCES_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5"
        >
          Sources docs
          <ExternalLink className="h-3 w-3" />
        </a>
        .
      </p>
    )
  }

  if (catalogSource === "github" && sourcesAvailable) {
    return (
      <p className="text-xs text-muted-foreground">
        Git tree catalog (Sources API did not return a synced catalog for this repo).{" "}
        <Link href="/sources" className="text-primary hover:underline">
          Register the source
        </Link>{" "}
        on Ludus 2.2.0+ for install tracking and metadata.
      </p>
    )
  }

  return null
}
