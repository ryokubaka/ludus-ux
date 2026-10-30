import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const ConsolePageClient = dynamicPageClient(
  () => import("./_console"),
  "ConsolePageClient",
)

export default function ConsolePage() {
  return <ConsolePageClient />
}
