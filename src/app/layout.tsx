import type { Metadata } from "next"
import "./globals.css"
import { AppShell } from "@/components/layout/app-shell"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { QueryProvider } from "@/components/providers/query-provider"
import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchGlobal } from "@/lib/server-prefetch"
import { getSession } from "@/lib/session"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"

export const metadata: Metadata = {
  title: "Ludus UX - Cyber Range User eXperience",
  description: "Open source web interface for Ludus Cyber Range",
  // Favicon points at /api/logo so it tracks the currently-configured LUX
  // logo (custom admin upload, falling back to the bundled default). The
  // `/favicon.ico` rewrite in next.config.js covers browsers that still
  // probe the legacy path directly.
  icons: {
    icon: [{ url: "/api/logo", type: "image/png" }],
    shortcut: "/api/logo",
    apple: "/api/logo",
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const dehydratedState = await prefetchGlobal(session)
  const initialScopeTag = session ? effectiveScopeTagFromSession(session) : "_guest|self"
  const shellSession = session
    ? {
        username: session.username,
        isAdmin: session.isAdmin,
        impersonationUserId: session.impersonationUserId ?? null,
      }
    : null

  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <QueryProvider initialScopeTag={initialScopeTag} shellSession={shellSession}>
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
