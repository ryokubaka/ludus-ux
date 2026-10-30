import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchDashboardData } from "@/lib/core/server-prefetch"

const DashboardPageClient = dynamicPageClient(
  () => import("./_dashboard"),
  "DashboardPageClient",
)

export default async function DashboardPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchDashboardData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <DashboardPageClient />
    </HydrationBoundary>
  )
}
