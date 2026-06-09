"use client"

import { usePathname, useRouter } from "next/navigation"
import { Sidebar } from "./sidebar"
import { Header } from "./header"
import { ImpersonationProvider, useImpersonation, IMPERSONATION_CHANGED_EVENT } from "@/lib/impersonation-context"
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
  const router = useRouter()
  if (!impersonation) return null

  const handleExit = () => {
    exitImpersonation()
    // Navigate to the dashboard after the event fires (which happens after the
    // cookie DELETE completes).  This ensures the admin lands on their own
    // dashboard with their own data, rather than staying on whatever page they
    // were viewing as the impersonated user.
    const onExit = () => {
      router.push("/")
      window.removeEventListener(IMPERSONATION_CHANGED_EVENT, onExit)
    }
    window.addEventListener(IMPERSONATION_CHANGED_EVENT, onExit)
  }

  return (
    <div className="flex items-center gap-3 bg-status-warning/10 border-b border-status-warning/30 px-4 py-2.5">
      <button
        type="button"
        onClick={handleExit}
        className="flex items-center gap-1.5 rounded-full bg-status-warning/20 border border-status-warning/40
                   px-3 py-1 text-xs font-semibold text-status-warning hover:bg-status-warning/30
                   hover:border-status-warning/60 transition-colors flex-shrink-0"
      >
        <LogOut className="h-3.5 w-3.5" />
        Exit Impersonation Mode
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <UserCheck className="h-4 w-4 text-status-warning flex-shrink-0" />
        <span className="text-sm text-foreground truncate">
          Viewing &amp; managing as{" "}
          <strong className="font-mono">{impersonation.username}</strong>
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
    <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <Sidebar />
      <Header />
      <main
        id="main-content"
        className={cn(
          "flex flex-1 flex-col min-h-0 pt-16",
          "transition-[padding-left] duration-200 ease-in-out",
          collapsed ? "pl-16" : "pl-64",
        )}
      >
        <ImpersonationBanner />
        <div className="flex flex-1 flex-col min-h-0 overflow-x-hidden overflow-y-auto p-6">{children}</div>
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
