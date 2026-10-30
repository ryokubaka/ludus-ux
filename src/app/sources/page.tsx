import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchSourcesData } from "@/lib/core/server-prefetch"

const SourcesPageClient = dynamicPageClient(
  () => import("./_sources"),
  "SourcesPageClient",
)

export default async function SourcesPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchSourcesData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <SourcesPageClient />
    </HydrationBoundary>
  )
}
