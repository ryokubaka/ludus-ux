import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const NewRangePageClient = dynamicPageClient(
  () => import("./_new"),
  "NewRangePageClient",
)

export default function NewRangePage() {
  return <NewRangePageClient />
}
