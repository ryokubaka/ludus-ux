import { Suspense } from "react"
import { AppShell } from "@/components/layout/app-shell"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { QueryProvider } from "@/components/providers/query-provider"
import { HydrationBoundary } from "@tanstack/react-query"
import { prefetchGlobal } from "@/lib/server-prefetch"
import { getLayoutSession } from "@/lib/session-layout"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { RouteSegmentLoading } from "@/components/route-segment-loading"

async function AuthenticatedRootInner({ children }: { children: React.ReactNode }) {
  const { session, resolved } = await getLayoutSession()
  const dehydratedState = await prefetchGlobal(resolved)
  const initialScopeTag = session ? effectiveScopeTagFromSession(session) : "_guest|self"
  const shellSession = session
    ? {
        username: session.username,
        isAdmin: session.isAdmin,
        impersonationUserId: session.impersonationUserId ?? null,
      }
    : null

  return (
    <QueryProvider initialScopeTag={initialScopeTag} shellSession={shellSession}>
      <HydrationBoundary state={dehydratedState}>
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </TooltipProvider>
      </HydrationBoundary>
    </QueryProvider>
  )
}

export function AuthenticatedRoot({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<RouteSegmentLoading />}>
      <AuthenticatedRootInner>{children}</AuthenticatedRootInner>
    </Suspense>
  )
}
