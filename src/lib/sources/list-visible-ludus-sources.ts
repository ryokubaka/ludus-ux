import "server-only"

import { resolveGlobalBlueprintServiceApiKey } from "@/lib/blueprints/blueprint-global-install"
import { listSources, type LudusSourceRow } from "@/lib/sources/ludus-source-client"
import { listPublishedSourceIds } from "@/lib/sources/source-publication"
import { assembleVisibleSources, type VisibleLudusSource } from "@/lib/sources/visible-ludus-sources"

/** Same source list as GET /api/sources, including share flags and shared catalogs. */
export async function listVisibleLudusSources(session: {
  isAdmin: boolean
  apiKey: string
}): Promise<VisibleLudusSource[]> {
  const own = await listSources(session.apiKey)
  const published = listPublishedSourceIds()
  let remote: LudusSourceRow[] = []
  let includeShared = false
  if (!session.isAdmin && published.size > 0) {
    const serviceKey = resolveGlobalBlueprintServiceApiKey(session)
    if (serviceKey && serviceKey !== session.apiKey) {
      includeShared = true
      remote = await listSources(serviceKey).catch(() => [])
    }
  }
  return assembleVisibleSources(own, remote, published, includeShared)
}
