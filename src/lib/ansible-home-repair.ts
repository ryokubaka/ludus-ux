import "server-only"

import type { NextRequest } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { sshExec } from "@/lib/goad-ssh"
import {
  buildEnsureAnsibleHomeRootCmd,
  buildVerifyAnsibleHomeShell,
} from "@/lib/ludus-ansible-preflight"
import type { SessionData } from "@/lib/session"

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

export function resolveSessionLinuxUser(
  session: Pick<
    SessionData,
    | "username"
    | "isAdmin"
    | "impersonationUserId"
    | "impersonationSshLogin"
    | "impersonationLudusUserId"
  >,
  request?: NextRequest,
): string {
  if (request) {
    const imp = resolveAdminImpersonationFromRequest(session, request)
    const fromImp = (imp.sshLogin || imp.ludusPrincipal || "").trim()
    if (fromImp) return fromImp.toLowerCase()
  }
  const impUser = session.impersonationSshLogin?.trim() || session.impersonationUserId?.trim()
  if (impUser) return impUser.toLowerCase()
  return (session.username || "").trim().toLowerCase()
}
