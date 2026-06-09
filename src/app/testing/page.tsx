import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { getLayoutSession } from "@/lib/session-layout"
import { prefetchTestingData } from "@/lib/server-prefetch"

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
