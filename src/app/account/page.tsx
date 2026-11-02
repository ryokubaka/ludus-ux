import { dynamicPageClient } from "@/lib/ui/dynamic-page-client"

const AccountPageClient = dynamicPageClient(
  () => import("./_account"),
  "AccountPageClient",
)

export default function AccountPage() {
  return <AccountPageClient />
}
