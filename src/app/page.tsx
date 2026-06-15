import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { getLayoutSession } from "@/lib/session-layout"
import { prefetchDashboardData } from "@/lib/server-prefetch"

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
