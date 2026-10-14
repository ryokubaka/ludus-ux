import { dynamicPageClient } from "@/lib/dynamic-page-client"

const LudushoundPageClient = dynamicPageClient(
  () => import("./_ludushound"),
  "LudushoundPageClient",
)

export default function LudushoundPage() {
  return <LudushoundPageClient />
}
