import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchAdminData } from "@/lib/server-prefetch"
import { AdminPageClient } from "./_admin"
import { resolveSessionFromCookies } from "@/lib/session"

export default async function AdminRangesPage() {
  const session = await resolveSessionFromCookies()
  const dehydratedState = await prefetchAdminData(session)
  return (
    <HydrationBoundary state={dehydratedState}>
      <AdminPageClient />
    </HydrationBoundary>
  )
}
