/**
 * POST /api/users/roll-key
 * Body: { userId: string }
 *
 * Uses Ludus v2 API: GET /user/apikey?userID=… (logged-in admin key on port 8080).
 * Per the Ludus API docs, the userID query param allows an admin to reset
 * any user's key in a single call — no SSH-read of the current key needed.
 *
 * After obtaining the new key, SSHes as root to update ~userId/.bashrc.
 *
 * Returns: { newKey: string, bashrcUpdated: boolean, bashrcError?: string }
 */
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { ludusGet, ludusRequest } from "@/lib/ludus-client"
import { LUDUS_USER_PROVISION_TIMEOUT_MS } from "@/lib/proxy-ludus-timeout"
import type { UserObject } from "@/lib/types"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

export const maxDuration = 600

export const dynamic = "force-dynamic"

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

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

  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const adminSession = admin.session

  // ── Step 1: Reset the key via Ludus API ─────────────────────────────────────
  // GET /user/apikey?userID=USERID on port 8080.
  // Must use the logged-in admin's own API key — the ROOT system key is only
  // valid on the admin port (8081) and will be rejected here with "Invalid API key".
  // Docs: https://api-docs.ludus.cloud/reset-and-retrieve-the-ludus-api-key-for-a-user-24251977e0
  const ludusResult = await ludusGet<{ result: { apiKey: string; userID: string } }>(
    `/user/apikey?userID=${encodeURIComponent(userId)}`,
    { apiKey: adminSession.apiKey, timeout: LUDUS_USER_PROVISION_TIMEOUT_MS },
  )

  if (ludusResult.error) {
    logLuxRouteAction(request, adminSession, { outcome: "failure", detail: ludusResult.error })
    return NextResponse.json(
      { error: `Ludus key reset failed: ${ludusResult.error}` },
      { status: 502 }
    )
  }

  const newKey = extractKey(ludusResult.data)
  if (!newKey) {
    logLuxRouteAction(request, adminSession, { outcome: "failure", detail: "Empty API key from Ludus" })
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
          apiKey: adminSession.apiKey,
          useAdminEndpoint: true,
          timeout: LUDUS_USER_PROVISION_TIMEOUT_MS,
        })
        const found = userListResult.data?.find(
          (u) => u.userID.toLowerCase() === userId.toLowerCase()
        )
        if (found?.proxmoxUsername) linuxUser = found.proxmoxUsername.toLowerCase()
      } catch {
        // fallback to userID
      }

      let homeDir = ""
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          homeDir = await sshExec(
            settings.sshHost, settings.sshPort, sshUser, sshPw,
            `getent passwd "${linuxUser}" 2>/dev/null | cut -d: -f6 || true`
          )
        } catch {
          homeDir = ""
        }
        if (homeDir?.trim()) break
        if (attempt < 7) await sleep(4000)
      }

      if (homeDir?.trim()) {
        await sshExec(
          settings.sshHost, settings.sshPort, sshUser, sshPw,
          `sed -i '/\\(export \\)\\?LUDUS_API_KEY=/d' ${homeDir}/.bashrc 2>/dev/null; ` +
          `sed -i '/\\(export \\)\\?LUDUS_VERSION=/d' ${homeDir}/.bashrc 2>/dev/null; ` +
          `echo 'export LUDUS_API_KEY=${newKey}' >> ${homeDir}/.bashrc; ` +
          `echo 'export LUDUS_VERSION=2' >> ${homeDir}/.bashrc`
        )
        const verify = await sshExec(
          settings.sshHost, settings.sshPort, sshUser, sshPw,
          `grep -c 'LUDUS_API_KEY=' "${homeDir}/.bashrc" 2>/dev/null || printf 0`
        )
        const n = parseInt(String(verify).trim(), 10)
        if (Number.isFinite(n) && n > 0) {
          bashrcUpdated = true
        } else {
          bashrcError =
            ".bashrc did not contain LUDUS_API_KEY after write (slow disk or permissions — use Roll API key once the account exists)"
        }
      } else {
        bashrcError =
          `Linux user "${linuxUser}" has no home yet after waiting — Ludus may still be provisioning. Use Roll API key again in a minute.`
      }
    } catch (err) {
      bashrcError = (err as Error).message
    }
  } else {
    bashrcError =
      "SSH not configured (LUDUS_SSH_HOST and root SSH password or private key required) — bashrc not updated"
  }

  logLuxRouteAction(request, adminSession, { detail: `userId=${userId} bashrcUpdated=${bashrcUpdated}` })
  return finishAdminResponse(
    NextResponse.json({ newKey, bashrcUpdated, bashrcError }),
    admin,
  )
}
