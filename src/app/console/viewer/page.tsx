"use client"

import { useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

/**
 * Thin redirect shim — immediately forwards to the static noVNC HTML page.
 * The actual VNC logic lives in /public/novnc-console.html (no webpack bundling).
 */
function ViewerRedirect() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const vmId   = searchParams.get("vmId") || ""
    const vmName = searchParams.get("vmName") || ""
    window.location.replace(
      `/novnc-console.html?vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}`
    )
  }, [searchParams])

  return (
    <div className="w-screen h-screen bg-zinc-950 flex items-center justify-center">
      <Loader2 className="h-10 w-10 text-primary animate-spin" />
    </div>
  )
}

export default function VncViewerPage() {
  return (
    <Suspense fallback={
      <div className="w-screen h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
      </div>
    }>
      <ViewerRedirect />
    </Suspense>
  )
}
