import Link from "next/link"
import { ExternalLink } from "lucide-react"

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
      <p className="text-xs text-muted-foreground">
        From{" "}
        {registeredSourceId ? (
          <code className="font-mono text-foreground">{registeredSourceId}</code>
        ) : (
          "a registered source"
        )}
        .{" "}
        <Link href="/sources" className="text-primary hover:underline">
          Sources
        </Link>
      </p>
    )
  }

  if (sourcesAvailable === false) {
    return (
      <p className="text-xs text-muted-foreground">
        Listed from the git tree. Ludus 2.2.0+ can register this source.{" "}
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
        Listed from the git tree.{" "}
        <Link href="/sources" className="text-primary hover:underline">
          Register the source
        </Link>{" "}
        for install tracking.
      </p>
    )
  }

  return null
}
