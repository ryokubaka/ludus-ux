import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchRangeConfigData } from "@/lib/core/server-prefetch"

const RangeBuilderPageClient = dynamicPageClient(
  () => import("./_builder"),
  "RangeBuilderPageClient",
)

export default async function RangeBuilderPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchRangeConfigData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <RangeBuilderPageClient />
    </HydrationBoundary>
  )
}
