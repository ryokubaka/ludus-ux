import "server-only"

import type { NextRequest } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin/admin-impersonation-request"
import { sshExec } from "@/lib/goad/goad-ssh"
import {
  buildEnsureAnsibleHomeRootCmd,
  buildVerifyAnsibleHomeShell,
} from "@/lib/ludus/ludus-ansible-preflight"
import type { SessionData } from "@/lib/session/session"

export interface EnsureAnsibleHomeLayoutOptions {
  /** Run sudo -u ludus test -w on ~/.ansible/cp after repair. */
  verify?: boolean
}

/**
 * Idempotent root SSH repair: cp/tmp ludus:ludus; galaxy tree user:ludus.
 * Safe after Ludus API installs and before range deploy (fresh + legacy users).
 */
export async function ensureAnsibleHomeLayoutAsRoot(
  linuxUser: string,
  options: EnsureAnsibleHomeLayoutOptions = {},
): Promise<void> {
  const user = linuxUser.trim()
  if (!user) return
  try {
    await sshExec(buildEnsureAnsibleHomeRootCmd(user))
    if (options.verify) {
      await sshExec(buildVerifyAnsibleHomeShell(user))
    }
  } catch {
    // Root SSH optional — GOAD preamble may still redirect ControlPath.
  }
}

/** @deprecated Prefer ensureAnsibleHomeLayoutAsRoot */
export async function repairAnsibleHomeAsRoot(linuxUser: string): Promise<void> {
  return ensureAnsibleHomeLayoutAsRoot(linuxUser)
}

export async function resolveSessionLinuxUser(
  session: Pick<
    SessionData,
    | "sessionId"
    | "username"
    | "isAdmin"
    | "impersonationUserId"
    | "impersonationSshLogin"
    | "impersonationLudusUserId"
  > & { apiKey?: string; impersonationApiKey?: string },
  request?: NextRequest,
): Promise<string> {
  if (request) {
    const imp = await resolveAdminImpersonationFromRequest(session, request)
    const fromImp = (imp.sshLogin || imp.ludusPrincipal || "").trim()
    if (fromImp) return fromImp.toLowerCase()
  }
  const impUser = session.impersonationSshLogin?.trim() || session.impersonationUserId?.trim()
  if (impUser) return impUser.toLowerCase()
  return (session.username || "").trim().toLowerCase()
}
