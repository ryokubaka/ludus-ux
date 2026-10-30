import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchTestingData } from "@/lib/core/server-prefetch"

const TestingPageClient = dynamicPageClient(
  () => import("./_testing"),
  "TestingPageClient",
)

export default async function TestingPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchTestingData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <TestingPageClient />
    </HydrationBoundary>
  )
}
