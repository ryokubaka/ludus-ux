import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchAdminData } from "@/lib/server-prefetch"
import { AdminPageClient } from "./_admin"

export default async function AdminRangesPage() {
  const dehydratedState = await prefetchAdminData()
  return (
    <HydrationBoundary state={dehydratedState}>
      <AdminPageClient />
    </HydrationBoundary>
  )
}
