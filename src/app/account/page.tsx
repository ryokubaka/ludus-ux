import { dynamicPageClient } from "@/lib/dynamic-page-client"

const AccountPageClient = dynamicPageClient(
  () => import("./_account"),
  "AccountPageClient",
)

export default function AccountPage() {
  return <AccountPageClient />
}
