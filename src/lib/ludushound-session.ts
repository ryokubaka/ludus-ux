import type { NextRequest } from "next/server"
import { resolveSession } from "@/lib/session"
import type { SSHCreds } from "@/lib/goad-ssh"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"

export async function resolveLudushoundSession(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return null

  const imp = resolveAdminImpersonationFromRequest(session, request)
  const apiKey = imp.apiKey || session.apiKey
  const impersonating = !!(session.isAdmin && imp.apiKey)

  // Impersonation: SSH as root (settings key), Ludus API as target user — same as GOAD.
  // Normal users: SSH with their session password.
  const creds: SSHCreds | undefined = impersonating
    ? undefined
    : session.sshPassword
      ? { username: session.username, password: session.sshPassword }
      : undefined

  return {
    session,
    creds,
    apiKey,
    linuxUser: impersonating
      ? (imp.sshLogin || imp.ludusPrincipal || "").trim() || session.username
      : session.username,
  }
}
