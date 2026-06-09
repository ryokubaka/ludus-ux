import { requireAdminPage } from "@/lib/require-admin-page"
import { AdminPerformancePageClient } from "./_performance"

export default async function AdminPerformancePage() {
  await requireAdminPage()
  return <AdminPerformancePageClient />
}
