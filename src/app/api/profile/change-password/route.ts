/**
 * POST /api/profile/change-password
 * Body: { currentPassword: string; newPassword: string }
 *
 * Self-service password change for any authenticated user.
 * Verifies the current password against the stored session credential,
 * then uses root SSH + chpasswd to apply the change.
 */
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { ludusRequest } from "@/lib/ludus-client"
import type { UserObject } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    currentPassword?: string
    newPassword?: string
  }
  const { currentPassword, newPassword } = body

  if (!currentPassword?.trim()) return NextResponse.json({ error: "Current password is required" }, { status: 400 })
  if (!newPassword?.trim()) return NextResponse.json({ error: "New password is required" }, { status: 400 })
  if (newPassword.length < 8) return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 })

  // Verify current password against the session credential
  if (session.sshPassword && currentPassword !== session.sshPassword) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 })
  }

  const settings = getSettings()
  if (!settings.sshHost || !isRootProxmoxSshConfigured(settings)) {
    return NextResponse.json({ error: "SSH not configured — contact an administrator" }, { status: 503 })
  }

  // Resolve Linux username (Ludus may map userID to a different proxmoxUsername)
  let linuxUser = session.username.toLowerCase()
  try {
    const userResult = await ludusRequest<UserObject[]>("/user/all", {
      apiKey: session.apiKey,
      useAdminEndpoint: true,
    })
    const found = userResult.data?.find(
      (u) => u.userID.toLowerCase() === session.username.toLowerCase()
    )
    if (found?.proxmoxUsername) linuxUser = found.proxmoxUsername.toLowerCase()
  } catch { /* fallback to username */ }

  // Change password via root SSH + chpasswd
  const escapedUser = linuxUser.replace(/"/g, '\\"')
  const escapedPw = newPassword
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")

  try {
    await sshExec(
      settings.sshHost, settings.sshPort,
      settings.proxmoxSshUser || "root", settings.proxmoxSshPassword || "",
      `printf '%s:%s\\n' "${escapedUser}" "${escapedPw}" | chpasswd`
    )
  } catch (err) {
    return NextResponse.json({ error: `Failed to change password: ${(err as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
