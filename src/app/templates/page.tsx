import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { getLayoutSession } from "@/lib/session-layout"
import { prefetchTemplatesData } from "@/lib/server-prefetch"

const TemplatesPageClient = dynamicPageClient(
  () => import("./_templates"),
  "TemplatesPageClient",
)

export default async function TemplatesPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchTemplatesData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <TemplatesPageClient />
    </HydrationBoundary>
  )
}
