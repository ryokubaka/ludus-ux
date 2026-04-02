/**
 * POST /api/users/roll-key
 * Body: { userId: string }
 *
 * Uses Ludus v2 API: GET /user/apikey?userID=USERID with the ROOT key.
 * Per the Ludus API docs, the userID query param allows an admin to reset
 * any user's key in a single call — no SSH-read of the current key needed.
 *
 * After obtaining the new key, SSHes as root to update ~userId/.bashrc.
 *
 * Returns: { newKey: string, bashrcUpdated: boolean, bashrcError?: string }
 */
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { ludusGet, ludusRequest } from "@/lib/ludus-client"
import type { UserObject } from "@/lib/types"

export const dynamic = "force-dynamic"

function extractKey(data: unknown): string {
  if (typeof data === "string") return data
  if (!data || typeof data !== "object") return ""
  const d = data as Record<string, unknown>
  // Top-level apiKey
  if (typeof d.apiKey === "string") return d.apiKey
  // result is a string
  if (typeof d.result === "string") return d.result
  // result is an object with apiKey inside  ← Ludus v2 actual shape
  if (d.result && typeof d.result === "object") {
    const r = d.result as Record<string, unknown>
    if (typeof r.apiKey === "string") return r.apiKey
  }
  return ""
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { userId?: string }
  const userId = body.userId?.trim()
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const settings = getSettings()

  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin privileges required to roll another user's key" }, { status: 403 })
  }

  // ── Step 1: Reset the key via Ludus API ─────────────────────────────────────
  // GET /user/apikey?userID=USERID on port 8080.
  // Must use the logged-in admin's own API key — the ROOT system key is only
  // valid on the admin port (8081) and will be rejected here with "Invalid API key".
  // Docs: https://api-docs.ludus.cloud/reset-and-retrieve-the-ludus-api-key-for-a-user-24251977e0
  const ludusResult = await ludusGet<{ result: { apiKey: string; userID: string } }>(
    `/user/apikey?userID=${encodeURIComponent(userId)}`,
    { apiKey: session.apiKey }
  )

  if (ludusResult.error) {
    return NextResponse.json(
      { error: `Ludus key reset failed: ${ludusResult.error}` },
      { status: 502 }
    )
  }

  const newKey = extractKey(ludusResult.data)
  if (!newKey) {
    return NextResponse.json(
      { error: "Ludus returned an empty API key — check the ROOT API key and server logs." },
      { status: 502 }
    )
  }

  // ── Step 2: Write new key to ~/.bashrc via root SSH ─────────────────────────
  let bashrcUpdated = false
  let bashrcError: string | undefined

  if (settings.sshHost && isRootProxmoxSshConfigured(settings)) {
    const sshUser = settings.proxmoxSshUser || "root"
    const sshPw = settings.proxmoxSshPassword || ""
    try {
      // Resolve the actual Linux username via the Ludus API (proxmoxUsername may differ
      // from userID, e.g. "pwtest2" → "pw-test-two").
      let linuxUser = userId.toLowerCase()
      try {
        const userListResult = await ludusRequest<UserObject[]>("/user/all", {
          apiKey: session.apiKey,
          useAdminEndpoint: true,
        })
        const found = userListResult.data?.find(
          (u) => u.userID.toLowerCase() === userId.toLowerCase()
        )
        if (found?.proxmoxUsername) linuxUser = found.proxmoxUsername.toLowerCase()
      } catch {
        // fallback to userID
      }

      const homeDir = await sshExec(
        settings.sshHost, settings.sshPort, sshUser, sshPw,
        `getent passwd "${linuxUser}" 2>/dev/null | cut -d: -f6 || true`
      )

      if (homeDir) {
        await sshExec(
          settings.sshHost, settings.sshPort, sshUser, sshPw,
          `sed -i '/\\(export \\)\\?LUDUS_API_KEY=/d' ${homeDir}/.bashrc 2>/dev/null; ` +
          `sed -i '/\\(export \\)\\?LUDUS_VERSION=/d' ${homeDir}/.bashrc 2>/dev/null; ` +
          `echo 'export LUDUS_API_KEY=${newKey}' >> ${homeDir}/.bashrc; ` +
          `echo 'export LUDUS_VERSION=2' >> ${homeDir}/.bashrc`
        )
        bashrcUpdated = true
      } else {
        bashrcError = `Linux user "${linuxUser}" not found — bashrc not updated`
      }
    } catch (err) {
      bashrcError = (err as Error).message
    }
  } else {
    bashrcError =
      "SSH not configured (LUDUS_SSH_HOST and root SSH password or private key required) — bashrc not updated"
  }

  return NextResponse.json({ newKey, bashrcUpdated, bashrcError })
}
