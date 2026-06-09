import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { getLayoutSession } from "@/lib/session-layout"
import { prefetchRangeConfigData } from "@/lib/server-prefetch"

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
