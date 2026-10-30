import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchBlueprintsData } from "@/lib/core/server-prefetch"

const BlueprintsPageClient = dynamicPageClient(
  () => import("./_blueprints"),
  "BlueprintsPageClient",
)

export default async function BlueprintsPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchBlueprintsData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <BlueprintsPageClient />
    </HydrationBoundary>
  )
}
