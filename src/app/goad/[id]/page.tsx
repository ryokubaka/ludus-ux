import { Suspense } from "react"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { RouteSegmentLoading } from "@/components/route-segment-loading"

const GoadInstancePageClient = dynamicPageClient(
  () => import("./goad-instance/goad-instance-page"),
  "GoadInstancePageClient",
)

export default async function GoadInstancePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Suspense has to sit outside the dynamic import. A query string on refresh
  // otherwise bails out of the root layout and the whole document becomes the
  // error screen.
  return (
    <Suspense fallback={<RouteSegmentLoading />}>
      <GoadInstancePageClient routeInstanceId={id} />
    </Suspense>
  )
}
