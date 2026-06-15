import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchAdminData } from "@/lib/server-prefetch"
import { getLayoutSession } from "@/lib/session-layout"
import { dynamicPageClient } from "@/lib/dynamic-page-client"

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
