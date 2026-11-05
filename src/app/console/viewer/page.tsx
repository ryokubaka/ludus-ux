import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const VncViewerPageClient = dynamicPageClient(
  () => import("./_viewer"),
  "VncViewerPageClient",
)

export default function VncViewerPage() {
  return <VncViewerPageClient />
}
