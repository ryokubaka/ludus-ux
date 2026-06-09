import { HydrationBoundary } from "@tanstack/react-query"
import { requireAdminPage } from "@/lib/require-admin-page"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { getLayoutSession } from "@/lib/session-layout"
import { prefetchUsersData } from "@/lib/server-prefetch"

const UsersPageClient = dynamicPageClient(
  () => import("./_users"),
  "UsersPageClient",
)

export default async function UsersPage() {
  await requireAdminPage()
  const { resolved } = await getLayoutSession()
  const dehydratedState = await prefetchUsersData(resolved)
  return (
    <HydrationBoundary state={dehydratedState}>
      <UsersPageClient />
    </HydrationBoundary>
  )
}
