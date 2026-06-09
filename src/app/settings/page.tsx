import { Suspense } from "react"
import { dynamicPageClient } from "@/lib/dynamic-page-client"
import { LuxVersionHeader } from "./lux-version-header"

const SettingsPageClient = dynamicPageClient(
  () => import("./_settings"),
  "SettingsPageClient",
)

export default function SettingsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex justify-end px-6 pt-3">
        <Suspense fallback={<span className="text-xs font-mono text-muted-foreground">v…</span>}>
          <LuxVersionHeader />
        </Suspense>
      </div>
      <SettingsPageClient />
    </div>
  )
}
