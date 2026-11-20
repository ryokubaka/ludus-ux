import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const LuxaiPageClient = dynamicPageClient(() => import("./_luxai"), "LuxaiPageClient")

export default function LuxaiPage() {
  return <LuxaiPageClient />
}
