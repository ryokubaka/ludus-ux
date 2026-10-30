import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const NewGoadInstancePageClient = dynamicPageClient(
  () => import("./_new"),
  "NewGoadInstancePageClient",
)

export default function NewGoadInstancePage() {
  return <NewGoadInstancePageClient />
}
