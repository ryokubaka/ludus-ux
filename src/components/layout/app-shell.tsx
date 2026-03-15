"use client"

import { usePathname } from "next/navigation"
import { Sidebar } from "./sidebar"
import { Header } from "./header"
import { ImpersonationProvider, useImpersonation } from "@/lib/impersonation-context"
import { RangeProvider } from "@/lib/range-context"
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context"
import { DeployLogProvider } from "@/lib/deploy-log-context"
import { UserCheck, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Global impersonation banner — shown across all pages when an admin is
 * managing on behalf of another user. Persists through client-side navigation.
 */
function ImpersonationBanner() {
  const { impersonation, exitImpersonation } = useImpersonation()
  if (!impersonation) return null

  return (
    <div className="flex items-center gap-3 bg-yellow-950/80 border-b border-yellow-500/30 px-4 py-2.5">
      <button
        onClick={exitImpersonation}
        className="flex items-center gap-1.5 rounded-full bg-yellow-500/20 border border-yellow-500/40
                   px-3 py-1 text-xs font-semibold text-yellow-300 hover:bg-yellow-500/30
                   hover:border-yellow-400/60 transition-colors flex-shrink-0"
      >
        <LogOut className="h-3.5 w-3.5" />
        Exit Impersonation Mode
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <UserCheck className="h-4 w-4 text-yellow-400 flex-shrink-0" />
        <span className="text-sm text-yellow-200 truncate">
          Viewing &amp; managing as{" "}
          <strong className="font-mono text-yellow-100">{impersonation.username}</strong>
          {" "}— all data and actions are scoped to this user
        </span>
      </div>
    </div>
  )
}

/** Inner shell — consumes SidebarContext to apply the correct offset. */
function ShellContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <Header />
      <main
        className={cn(
          "pt-16 min-h-screen flex flex-col",
          "transition-[padding-left] duration-200 ease-in-out",
          collapsed ? "pl-16" : "pl-64",
        )}
      >
        <ImpersonationBanner />
        <div className="p-6 flex-1">{children}</div>
      </main>
    </div>
  )
}

/**
 * Conditionally renders the sidebar + header chrome.
 * The /login page renders without it (full screen auth layout).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname === "/login" || pathname.startsWith("/login/")
  // /console is a full-screen VM console with its own minimal toolbar
  const isFullscreen = pathname === "/console" || pathname.startsWith("/console/")

  if (isLoginPage) {
    return <>{children}</>
  }

  // /console is fullscreen (no sidebar/header) but still needs context providers
  // so useRange() and useImpersonation() work correctly on that page.
  if (isFullscreen) {
    return (
      <ImpersonationProvider>
        <RangeProvider>
          <DeployLogProvider>
            {children}
          </DeployLogProvider>
        </RangeProvider>
      </ImpersonationProvider>
    )
  }

  return (
    <ImpersonationProvider>
      <RangeProvider>
        <DeployLogProvider>
          <SidebarProvider>
            <ShellContent>{children}</ShellContent>
          </SidebarProvider>
        </DeployLogProvider>
      </RangeProvider>
    </ImpersonationProvider>
  )
}
