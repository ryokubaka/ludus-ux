import { dynamicPageClient } from "@/lib/dynamic-page-client"

const NewGoadInstancePageClient = dynamicPageClient(
  () => import("./_new"),
  "NewGoadInstancePageClient",
)

export default function NewGoadInstancePage() {
  return <NewGoadInstancePageClient />
}
