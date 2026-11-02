import { requireAdminPage } from "@/lib/session/require-admin-page"
import { AdminPerformancePageClient } from "./_performance"

export default async function AdminPerformancePage() {
  await requireAdminPage()
  return <AdminPerformancePageClient />
}
