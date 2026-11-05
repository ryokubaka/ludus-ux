import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchRangeConfigData } from "@/lib/core/server-prefetch"

const RangeConfigPageClient = dynamicPageClient(
  () => import("./_config"),
  "RangeConfigPageClient",
)

export default async function RangeConfigPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchRangeConfigData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <RangeConfigPageClient />
    </HydrationBoundary>
  )
}
