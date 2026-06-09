import "server-only"

import { redirect } from "next/navigation"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import { resolveSessionFromCookies, type ResolvedSession } from "@/lib/session"
import { resolveLudusIsAdmin } from "@/lib/session-admin-check"

/**
 * Server-side admin gate for App Router pages. Redirects unauthenticated users to
 * login and non-admins to home after a live Ludus admin check.
 */
export async function requireAdminPage(): Promise<ResolvedSession> {
  await markRouteDynamic()
  const session = await resolveSessionFromCookies()
  if (!session) redirect("/login")

  const ludusIsAdmin = await resolveLudusIsAdmin(session)
  if (!ludusIsAdmin) redirect("/")

  return ludusIsAdmin === session.isAdmin ? session : { ...session, isAdmin: ludusIsAdmin }
}
