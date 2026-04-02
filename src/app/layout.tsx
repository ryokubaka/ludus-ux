import type { Metadata } from "next"
import "./globals.css"
import { AppShell } from "@/components/layout/app-shell"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { QueryProvider } from "@/components/providers/query-provider"
import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchGlobal } from "@/lib/server-prefetch"

export const metadata: Metadata = {
  title: "Ludus UX - Cyber Range User eXperience",
  description: "Open source web interface for Ludus Cyber Range",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const dehydratedState = await prefetchGlobal()

  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <QueryProvider>
          <HydrationBoundary state={dehydratedState}>
            <TooltipProvider>
              <AppShell>{children}</AppShell>
              <Toaster />
            </TooltipProvider>
          </HydrationBoundary>
        </QueryProvider>
      </body>
    </html>
  )
}
