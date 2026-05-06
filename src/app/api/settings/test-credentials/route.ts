/**
 * POST /api/settings/test-credentials
 *
 * Admin-only diagnostic: verifies root SSH (same path as admin tunnel / pvesh)
 * and reachability of the Ludus admin API URL using the current session API key.
 *
 * Optional JSON body fields override persisted settings for this request only
 * (use the Settings form draft without saving first).
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings, type RuntimeSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import {
  describePrivateKeyPermissionIssue,
  getResolvedPrivateKeyPath,
  probeSshKeyMount,
} from "@/lib/root-ssh-auth"

export const dynamic = "force-dynamic"

type Body = Partial<{
  ludusUrl: string
  ludusAdminUrl: string
  sshHost: string
  sshPort: number
  proxmoxSshUser: string
  proxmoxSshPassword: string
  proxmoxSshKeyPath: string
}>

function mergeTestSettings(base: RuntimeSettings, body: Body): RuntimeSettings {
  const next = { ...base }
  if (body.ludusUrl !== undefined) next.ludusUrl = body.ludusUrl
  if (body.ludusAdminUrl !== undefined) next.ludusAdminUrl = body.ludusAdminUrl
  if (body.sshHost !== undefined) next.sshHost = body.sshHost
  if (body.sshPort !== undefined) {
    const n = typeof body.sshPort === "number" ? body.sshPort : parseInt(String(body.sshPort), 10)
    if (!Number.isNaN(n)) next.sshPort = n
  }
  if (body.proxmoxSshUser !== undefined) next.proxmoxSshUser = body.proxmoxSshUser
  if (body.proxmoxSshPassword !== undefined) next.proxmoxSshPassword = body.proxmoxSshPassword
  if (body.proxmoxSshKeyPath !== undefined) next.proxmoxSshKeyPath = body.proxmoxSshKeyPath.trim()
  return next
}

function resolveAdminBaseUrl(s: Pick<RuntimeSettings, "ludusUrl" | "ludusAdminUrl">): string {
  let baseUrl = s.ludusUrl || ""
  if ((s.ludusAdminUrl || "").trim()) {
    baseUrl = s.ludusAdminUrl.trim()
  } else if (baseUrl) {
    baseUrl = baseUrl.replace(/:8080\b/, ":8081")
  }
  return baseUrl.replace(/\/$/, "")
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 403 })
  }

  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    body = {}
  }

  const effective = mergeTestSettings(getSettings(), body)
  const apiKey = session.apiKey || ""

  const keyProbe = probeSshKeyMount(effective)
  const keyPath = getResolvedPrivateKeyPath(effective)
  const pw = (effective.proxmoxSshPassword || "").trim()
  const authAttempted: "password" | "private_key" | "none" = pw
    ? "password"
    : keyPath
      ? "private_key"
      : "none"

  // ── Root SSH (admin tunnel uses the same auth at container boot) ─────────
  const rootSsh: {
    ok: boolean
    host: string
    port: number
    user: string
    authAttempted: typeof authAttempted
    privateKeyPath: string | null
    detail?: string
  } = {
    ok: false,
    host: effective.sshHost || "",
    port: effective.sshPort || 22,
    user: (effective.proxmoxSshUser || "root").trim() || "root",
    authAttempted,
    privateKeyPath: pw ? null : keyPath,
  }

  if (!effective.sshHost?.trim()) {
    rootSsh.detail = "SSH host is empty — set LUDUS_SSH_HOST / SSH Host in Settings."
  } else if (authAttempted === "none") {
    const permHint = describePrivateKeyPermissionIssue(effective)
    const probeHint =
      keyProbe.sshDirError ||
      (keyProbe.sshDirListing && keyProbe.sshDirListing.length
        ? `Files in /app/ssh: ${keyProbe.sshDirListing.join(", ")}`
        : null)
    rootSsh.detail =
      permHint ??
      [
        "No readable private key found. See keyProbe in this response: each path shows exists/readable/readError.",
        probeHint,
        `Env PROXMOX_SSH_KEY_PATH=${JSON.stringify(keyProbe.env.PROXMOX_SSH_KEY_PATH ?? "")}`,
        `SQLite settings key path=${JSON.stringify(keyProbe.settingsKeyPath)}`,
        keyProbe.effectiveKeyPath != null
          ? `Form override path=${JSON.stringify(keyProbe.effectiveKeyPath)}`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
  } else {
    try {
      const out = await sshExec(
        effective.sshHost.trim(),
        effective.sshPort || 22,
        rootSsh.user,
        effective.proxmoxSshPassword || "",
        "echo lux_root_ssh_ok",
      )
      rootSsh.ok = out.includes("lux_root_ssh_ok")
      if (!rootSsh.ok) {
        rootSsh.detail = `Unexpected SSH output: ${out.slice(0, 120)}`
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      rootSsh.detail = msg
      if (/All configured authentication methods failed/i.test(msg)) {
        rootSsh.detail +=
          " Common causes: wrong key file, wrong PROXMOX_SSH_USER, host/port unreachable from the container, or — if this private key was copied from the server's /root/.ssh/id_rsa — the matching public key is not in /root/.ssh/authorized_keys on the Ludus host (one-time fix in README: «Root private key copied from the Ludus server»). CRLF in the key is normalized by LUX; container shows 777 on Windows mounts — entrypoint chmod 600s the key at startup."
      }
    }
  }

  // ── Admin API (same URL logic as ludus-client) ────────────────────────────
  const adminBase = resolveAdminBaseUrl(effective)
  const adminApi: {
    ok: boolean
    baseUrl: string
    detail?: string
    hint?: string
  } = { ok: false, baseUrl: adminBase || "(not configured)" }

  if (!adminBase) {
    adminApi.detail = "Ludus URL is empty — cannot derive admin API address."
  } else if (!apiKey) {
    adminApi.detail = "No API key in session — log out and back in."
  } else {
    // Port 8081 rejects many routes (e.g. GET /api/v2/) — use an admin-allowed call.
    const url = `${adminBase}/api/v2/user/all`
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 12_000)
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        cache: "no-store",
        signal: controller.signal,
      })
      clearTimeout(t)
      const text = await res.text().catch(() => "")
      if (res.ok) {
        adminApi.ok = true
        adminApi.detail = `HTTP ${res.status} — admin API reachable (GET /user/all).`
      } else {
        adminApi.detail = `HTTP ${res.status}: ${text.slice(0, 200)}`
        if (res.status === 401 || res.status === 403) {
          adminApi.hint = "API key rejected — confirm your Ludus user is an admin and the key is current."
        }
        // Ludus returns 500 for disallowed routes on 8081 — if we ever hit one, treat as reachable.
        if (
          res.status === 500 &&
          /:8081 endpoint can only be used/i.test(text) &&
          /Use the :8080 endpoint/i.test(text)
        ) {
          adminApi.ok = true
          adminApi.detail =
            "Admin API host responded (Ludus rejected this specific route on 8081 — that confirms TLS/TCP reachability). GET /user/all should be used for a definitive check."
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      adminApi.detail =
        err instanceof Error && err.name === "AbortError" ? "Request timed out (12s)." : msg
      const isConn =
        /ECONNREFUSED|fetch failed|network|ENOTFOUND|ETIMEDOUT|aborted/i.test(msg) ||
        err instanceof Error && err.name === "AbortError"
      if (isConn) {
        if (adminBase.includes("127.0.0.1") || adminBase.includes("localhost")) {
          adminApi.hint =
            "This URL points at the container itself. It only works when the admin SSH tunnel is up: root SSH must succeed at container start (see Root SSH test above). Restart the container after fixing SSH, or set LUDUS_ADMIN_URL to a URL the container can reach (e.g. https://<ludus-ip>:8081 if bound on all interfaces)."
        } else {
          adminApi.hint =
            "Check firewall, TLS, and that Ludus admin API listens on this host:port. If 8081 is loopback-only on the server, use the tunnel (127.0.0.1:18081) with working root SSH."
        }
      }
    }
  }

  return NextResponse.json({ rootSsh, adminApi, keyProbe })
}
