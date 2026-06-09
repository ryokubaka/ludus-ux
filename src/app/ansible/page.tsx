import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { getLayoutSession } from "@/lib/session-layout"
import { prefetchAnsibleData } from "@/lib/server-prefetch"

const AnsiblePageClient = dynamicPageClient(
  () => import("./_ansible"),
  "AnsiblePageClient",
)

export default async function AnsiblePage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchAnsibleData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <AnsiblePageClient />
    </HydrationBoundary>
  )
}
