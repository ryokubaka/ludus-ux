import { requireAdminPage } from "@/lib/session/require-admin-page"
import { AdminAppLogsPageClient } from "./_app-logs"

export default async function AdminAppLogsPage() {
  await requireAdminPage()
  return <AdminAppLogsPageClient />
}
