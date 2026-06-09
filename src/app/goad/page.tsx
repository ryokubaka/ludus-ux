import { dynamicPageClient } from "@/lib/dynamic-page-client"

const GoadPageClient = dynamicPageClient(
  () => import("./_goad"),
  "GoadPageClient",
)

export default function GoadPage() {
  return <GoadPageClient />
}
