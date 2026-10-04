import { randomBytes } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { getLuxHostUpdateKey, getSettings, setLuxHostUpdateKey, type RuntimeSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import {
  LUX_HOST_VERIFY_CMD,
  buildLuxHostInstallShell,
  explainLuxHostInstallFailure,
  loadLuxHostInstallPayload,
  luxHostSudoUsernameError,
  redactSecret,
} from "@/lib/lux-host-install"

type Body = Partial<{
  sshHost: string
  sshPort: number
  proxmoxSshUser: string
  proxmoxSshPassword: string
  /** Used once to SSH as root. Not stored. */
  rootPassword: string
}>

function merge(base: RuntimeSettings, body: Body): RuntimeSettings {
  const next = { ...base }
  if (body.sshHost !== undefined) next.sshHost = body.sshHost
  if (body.sshPort !== undefined) {
    const n = typeof body.sshPort === "number" ? body.sshPort : parseInt(String(body.sshPort), 10)
    if (!Number.isNaN(n)) next.sshPort = n
  }
  if (body.proxmoxSshUser !== undefined) next.proxmoxSshUser = body.proxmoxSshUser
  if (body.proxmoxSshPassword !== undefined) next.proxmoxSshPassword = body.proxmoxSshPassword
  return next
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    body = {}
  }

  const settings = merge(getSettings(), body)
  const user = (settings.proxmoxSshUser || "").trim()
  const userError = luxHostSudoUsernameError(user)
  if (userError) {
    return finishAdminResponse(NextResponse.json({ error: userError }, { status: 400 }), admin)
  }
  const host = settings.sshHost.trim()
  if (!host) {
    return finishAdminResponse(
      NextResponse.json({ error: "SSH host is empty." }, { status: 400 }),
      admin,
    )
  }
  const password = (settings.proxmoxSshPassword || "").trim()
  const rootPassword = typeof body.rootPassword === "string" ? body.rootPassword.trim() : ""
  if (!rootPassword) {
    return finishAdminResponse(
      NextResponse.json(
        { error: "The Ludus host root password is required to install lux-host." },
        { status: 400 },
      ),
      admin,
    )
  }
  for (const secret of [password, rootPassword]) {
    if (secret.includes("\n") || secret.includes("\r")) {
      return finishAdminResponse(
        NextResponse.json({ error: "Passwords cannot contain a newline." }, { status: 400 }),
        admin,
      )
    }
  }

  const port = settings.sshPort || 22
  const updateKey = getLuxHostUpdateKey() || randomBytes(32).toString("hex")
  const runAsUser = (command: string, stdin?: string) =>
    sshExec(host, port, user, password, command, { elevate: false, stdin })
  const runAsRoot = (command: string, stdin?: string) =>
    sshExec(host, port, "root", rootPassword, command, { elevate: false, stdin })

  try {
    const payload = loadLuxHostInstallPayload(user)
    await runAsRoot(buildLuxHostInstallShell(payload.helperB64, payload.sudoersB64, "root"), updateKey)

    const verify = (await runAsUser(LUX_HOST_VERIFY_CMD)).trim()
    if (verify !== "0") {
      logLuxRouteAction(request, admin.session, { outcome: "failure", detail: `${user}: verify returned ${verify}` })
      return finishAdminResponse(
        NextResponse.json({
          error: "The helper was written, but sudo -n /usr/local/sbin/lux-host did not return uid 0.",
        }, { status: 500 }),
        admin,
      )
    }

    setLuxHostUpdateKey(updateKey)
    logLuxRouteAction(request, admin.session, { detail: user })
    return finishAdminResponse(
      NextResponse.json({
        ok: true,
        message: `${user} can run sudo -n /usr/local/sbin/lux-host. Other sudo commands still need a password.`,
      }),
      admin,
    )
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Install failed"
    const explained = explainLuxHostInstallFailure(raw, user)
      ?? (rootPassword && /authentication methods failed|all configured authentication/i.test(raw)
        ? "Could not SSH as root with that password. Paste the root shell command from this dialog into a root shell on the Ludus host."
        : null)
    const message = explained ?? redactSecret(redactSecret(redactSecret(raw, password), rootPassword), updateKey)
    logLuxRouteAction(request, admin.session, { outcome: "failure", detail: message.slice(0, 300) })
    const status = explained || /sorry|incorrect password|authentication/i.test(message) ? 400 : 500
    return finishAdminResponse(NextResponse.json({ error: message }, { status }), admin)
  }
}
