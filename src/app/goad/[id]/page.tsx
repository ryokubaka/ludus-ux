import { dynamicPageClient } from "@/lib/dynamic-page-client"

const GoadInstancePageClient = dynamicPageClient(
  () => import("./goad-instance/goad-instance-page"),
  "GoadInstancePageClient",
)

export default function GoadInstancePage() {
  return <GoadInstancePageClient />
}
