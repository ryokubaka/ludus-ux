/**
 * POST /api/users/change-password
 * Body: { userId: string; newPassword: string }
 *
 * SSHes into the Ludus server as root and runs chpasswd to change the user's
 * Linux/PAM password (which is shared with Proxmox PAM realm).
 *
 * Ludus maps userIDs to Linux usernames differently (e.g. "pwtest2" → "pw-test-two"),
 * so we first call the Ludus API to resolve the proxmoxUsername, then fall back to
 * a direct getent passwd lookup by userID if the API call fails.
 */
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { ludusRequest } from "@/lib/ludus-client"
import { LUDUS_USER_PROVISION_TIMEOUT_MS } from "@/lib/proxy-ludus-timeout"
import type { UserObject } from "@/lib/types"

export const maxDuration = 600

export const dynamic = "force-dynamic"

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!session.isAdmin) return NextResponse.json({ error: "Admin required" }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { userId?: string; newPassword?: string }
  const { userId, newPassword } = body

  if (!userId?.trim()) return NextResponse.json({ error: "userId is required" }, { status: 400 })
  if (!newPassword?.trim()) return NextResponse.json({ error: "newPassword is required" }, { status: 400 })

  const settings = getSettings()
  if (!settings.sshHost || !isRootProxmoxSshConfigured(settings)) {
    return NextResponse.json({ error: "SSH not configured" }, { status: 503 })
  }

  // Resolve the actual Linux username. Ludus v2 uses proxmoxUsername (which may differ
  // from userID, e.g. "pwtest2" → "pw-test-two"). We ask the Ludus API first, then
  // fall back to using userID directly if the lookup fails.
  let linuxUser = userId.toLowerCase()
  try {
    const userResult = await ludusRequest<UserObject[]>("/user/all", {
      apiKey: session.apiKey,
      useAdminEndpoint: true,
      timeout: LUDUS_USER_PROVISION_TIMEOUT_MS,
    })
    const found = userResult.data?.find(
      (u) => u.userID.toLowerCase() === userId.toLowerCase()
    )
    if (found?.proxmoxUsername) {
      linuxUser = found.proxmoxUsername.toLowerCase()
    }
  } catch {
    // fallback to userID
  }

  // Verify the Linux user exists
  let homeDir = ""
  const sshHost = settings.sshHost
  const sshPort = settings.sshPort
  const sshUser = settings.proxmoxSshUser || "root"
  const sshPw = settings.proxmoxSshPassword || ""

  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        homeDir = await sshExec(
          sshHost, sshPort,
          sshUser, sshPw,
          `getent passwd "${linuxUser}" 2>/dev/null | cut -d: -f6 || true`
        )
      } catch {
        homeDir = ""
      }
      if (homeDir?.trim()) break
      if (attempt < 7) await sleep(4000)
    }
  } catch (err) {
    return NextResponse.json({ error: `SSH error: ${(err as Error).message}` }, { status: 500 })
  }

  if (!homeDir) {
    return NextResponse.json(
      {
        error: `Linux user "${linuxUser}" (userID: ${userId}) not found after waiting — still provisioning or wrong host. Retry in a minute.`,
      },
      { status: 404 },
    )
  }

  // Change password via chpasswd — handle special characters safely
  const escapedUser = linuxUser.replace(/"/g, '\\"')
  const escapedPw = newPassword
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
  try {
    await sshExec(
      sshHost, sshPort,
      sshUser, sshPw,
      `printf '%s:%s\\n' "${escapedUser}" "${escapedPw}" | chpasswd`
    )
  } catch (err) {
    return NextResponse.json({ error: `Failed to change password: ${(err as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
