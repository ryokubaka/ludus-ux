import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { getSettings, type RuntimeSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import {
  LUX_HOST_VERIFY_CMD,
  buildLuxHostInstallShell,
  explainLuxHostInstallFailure,
  loadLuxHostInstallPayload,
  luxHostSudoUsernameError,
  redactSecret,
  selectLuxHostInstallMode,
} from "@/lib/lux-host-install"
import { buildLuxHostAuthProbeCommand, parseRootSshProbe } from "@/lib/root-ssh-preflight"

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
  for (const secret of [password, rootPassword]) {
    if (secret.includes("\n") || secret.includes("\r")) {
      return finishAdminResponse(
        NextResponse.json({ error: "Passwords cannot contain a newline." }, { status: 400 }),
        admin,
      )
    }
  }

  const port = settings.sshPort || 22
  const runAsUser = (command: string, stdin?: string) =>
    sshExec(host, port, user, password, command, { elevate: false, stdin })
  const runAsRoot = (command: string) =>
    sshExec(host, port, "root", rootPassword, command, { elevate: false })

  try {
    const payload = loadLuxHostInstallPayload(user)
    if (rootPassword) {
      await runAsRoot(buildLuxHostInstallShell(payload.helperB64, payload.sudoersB64, "root"))
    } else {
      const who = await runAsUser(buildLuxHostAuthProbeCommand())
      const auth = parseRootSshProbe(who)
      const mode = selectLuxHostInstallMode({
        uid: auth.uid,
        sudoAll: auth.sudoAll === true,
        sudoHelper: auth.sudo === true,
        hasUserPassword: password.length > 0,
      })
      if (!mode) {
        return finishAdminResponse(
          NextResponse.json({
            error: "Enter this account's password, or the Ludus host root password. The root password is used once and is not saved.",
          }, { status: 400 }),
          admin,
        )
      }
      await runAsUser(
        buildLuxHostInstallShell(payload.helperB64, payload.sudoersB64, mode),
        mode === "sudo-s" ? `${password}\n` : undefined,
      )
    }

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
        ? "Could not SSH as root with that password. If root login is key-only, install the rule from a root shell on the Ludus host."
        : null)
    const message = explained ?? redactSecret(redactSecret(raw, password), rootPassword)
    logLuxRouteAction(request, admin.session, { outcome: "failure", detail: message.slice(0, 300) })
    const status = explained || /sorry|incorrect password|authentication/i.test(message) ? 400 : 500
    return finishAdminResponse(NextResponse.json({ error: message }, { status }), admin)
  }
}
