import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchAdminData } from "@/lib/core/server-prefetch"
import { getLayoutSession } from "@/lib/session/session-layout"
import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const AdminPageClient = dynamicPageClient(
  () => import("./_admin"),
  "AdminPageClient",
)

export default async function AdminRangesPage() {
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchAdminData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <AdminPageClient />
    </HydrationBoundary>
  )
}
