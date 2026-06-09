import "server-only"
import { cacheLife } from "next/cache"

/** Build-time stable LUX semver — safe to cache across requests. */
export async function getCachedLuxVersion(): Promise<string> {
  "use cache"
  cacheLife("days")
  const { version } = await import("../../package.json")
  return version
}
