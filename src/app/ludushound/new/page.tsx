import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const NewLudushoundPageClient = dynamicPageClient(
  () => import("./_new"),
  "NewLudushoundPageClient",
)

export default function NewLudushoundPage() {
  return <NewLudushoundPageClient />
}
