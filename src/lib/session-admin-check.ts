import { ludusRequest } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"
import type { SessionData } from "@/lib/session"

/** Resolve current Ludus admin flag for the logged-in user (same logic as login). */
export async function resolveLudusIsAdmin(session: SessionData): Promise<boolean> {
  try {
    const result = await ludusRequest<unknown>("/user", { apiKey: session.apiKey })
    if (result.error || result.status !== 200) return session.isAdmin
    const profile = ludusCallerFromGetUser(result.data, session.username)
    if (!profile) return session.isAdmin
    return profile.user.isAdmin
  } catch {
    return session.isAdmin
  }
}
