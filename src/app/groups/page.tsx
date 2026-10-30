import { HydrationBoundary } from "@tanstack/react-query"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"
import { getLayoutSession } from "@/lib/session/session-layout"
import { prefetchGroupsData } from "@/lib/core/server-prefetch"

const GroupsPageClient = dynamicPageClient(
  () => import("./_groups"),
  "GroupsPageClient",
)

export default async function GroupsPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchGroupsData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <GroupsPageClient />
    </HydrationBoundary>
  )
}
