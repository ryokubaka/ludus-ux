import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchAnsibleData } from "@/lib/core/server-prefetch"

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
