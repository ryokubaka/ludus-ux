import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { getLayoutSession } from "@/lib/session-layout"
import { prefetchSnapshotsData } from "@/lib/server-prefetch"

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
