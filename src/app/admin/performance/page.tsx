"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { Loader2, ShieldAlert } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useResolvedSession } from "@/hooks/use-resolved-session"

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

export default function AdminPerformancePage() {
  const router = useRouter()
  const session = useResolvedSession()

  useEffect(() => {
    if (session && !session.loading && !session.isAdmin) {
      router.replace("/")
    }
  }, [session, router])

  if (!session || session.loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    )
  }

  if (!session.isAdmin) {
    return (
      <Alert variant="destructive" className="max-w-lg mx-auto mt-8">
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>Admin access required.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <LudusPerformanceTab />
    </div>
  )
}
