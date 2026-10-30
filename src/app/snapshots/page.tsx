import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchSnapshotsData } from "@/lib/core/server-prefetch"

const SnapshotsPageClient = dynamicPageClient(
  () => import("./_snapshots"),
  "SnapshotsPageClient",
)

export default async function SnapshotsPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchSnapshotsData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <SnapshotsPageClient />
    </HydrationBoundary>
  )
}
