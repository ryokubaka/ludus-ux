import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchRangeStatus } from "@/lib/server-prefetch"
import { DashboardPageClient } from "./_dashboard"

export default async function DashboardPage() {
  const dehydratedState = await prefetchRangeStatus()
  return (
    <HydrationBoundary state={dehydratedState}>
      <DashboardPageClient />
    </HydrationBoundary>
  )
}
