import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchLogsData } from "@/lib/core/server-prefetch"

const LogsPageClient = dynamicPageClient(
  () => import("./_logs"),
  "LogsPageClient",
)

export default async function LogsPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchLogsData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <LogsPageClient />
    </HydrationBoundary>
  )
}
