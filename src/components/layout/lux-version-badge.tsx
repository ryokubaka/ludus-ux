import { getCachedLuxVersion } from "@/lib/cached-lux-version"

/** Cached server component — static semver for settings/about chrome. */
export async function LuxVersionBadge({ className }: { className?: string }) {
  const version = await getCachedLuxVersion()
  return (
    <span className={className} title="Ludus UX version">
      v{version}
    </span>
  )
}
