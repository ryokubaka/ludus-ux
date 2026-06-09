"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

const LudusPerformanceTab = dynamic(
  () =>
    import("@/components/settings/ludus-performance-tab").then((m) => ({
      default: m.LudusPerformanceTab,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="text-muted-foreground text-sm py-8 text-center flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading performance…
      </div>
    ),
  },
)

export function AdminPerformancePageClient() {
  return (
    <div className="p-4 md:p-6">
      <LudusPerformanceTab />
    </div>
  )
}
