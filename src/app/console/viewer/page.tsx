import { dynamicPageClient } from "@/lib/dynamic-page-client"

const VncViewerPageClient = dynamicPageClient(
  () => import("./_viewer"),
  "VncViewerPageClient",
)

export default function VncViewerPage() {
  return <VncViewerPageClient />
}
