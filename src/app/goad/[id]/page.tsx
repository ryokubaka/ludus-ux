import { dynamicPageClient } from "@/lib/dynamic-page-client"

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
  return <GoadInstancePageClient routeInstanceId={id} />
}
