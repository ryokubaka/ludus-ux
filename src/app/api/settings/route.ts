import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"
import { getSettings, updateSettings, type RuntimeSettings } from "@/lib/settings/settings-store"
import { isLudusRootApiKeyEnvOverrideActive } from "@/lib/users/resolve-root-api-key"
import { invalidateCatalogCache } from "@/lib/goad/goad-ssh"
import { clientIpFromRequest } from "@/lib/session/security-audit-log"
import { logAppEvent } from "@/lib/logs/app-log"
import { liveSessionIsAdmin, refreshRevokedAdminCookie } from "@/lib/session/session-admin-check"
import {
  endpointSettingsChanged,
  secretsMatch,
  toPublicSettings,
} from "@/lib/settings/settings-public"

function nonEmptySecret(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (value.trim() === "") return undefined
  return value
}

export async function GET(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response

  const settings = getSettings()
  const isAdmin = await liveSessionIsAdmin(gate.session)
  return refreshRevokedAdminCookie(
    NextResponse.json(
      toPublicSettings(settings, {
        isAdmin,
        rootApiKeyOverriddenByEnv: isLudusRootApiKeyEnvOverrideActive(),
      }),
    ),
    gate.session,
    isAdmin,
  )
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const record = body as Record<string, unknown>
  const patch: Partial<RuntimeSettings> = {}
  if (typeof record.ludusUrl === "string") patch.ludusUrl = record.ludusUrl.trim()
  if (typeof record.ludusAdminUrl === "string") patch.ludusAdminUrl = record.ludusAdminUrl.trim()
  if (typeof record.sshHost === "string") patch.sshHost = record.sshHost.trim()
  if (typeof record.sshPort === "number") patch.sshPort = record.sshPort
  if (typeof record.goadPath === "string") patch.goadPath = record.goadPath.trim()
  if (typeof record.ludushoundPath === "string") patch.ludushoundPath = record.ludushoundPath.trim()
  if (typeof record.ludusInstallPath === "string") patch.ludusInstallPath = record.ludusInstallPath.trim()
  if (typeof record.goadEnabled === "boolean") patch.goadEnabled = record.goadEnabled
  if (typeof record.ludushoundEnabled === "boolean") patch.ludushoundEnabled = record.ludushoundEnabled
  if (typeof record.ludusAnsibleVerbose === "boolean") patch.ludusAnsibleVerbose = record.ludusAnsibleVerbose
  if (typeof record.useLudusHostDns === "boolean") patch.useLudusHostDns = record.useLudusHostDns
  const rootApiKey = nonEmptySecret(record.rootApiKey)
  if (rootApiKey !== undefined) patch.rootApiKey = rootApiKey.trim()
  if (typeof record.proxmoxSshUser === "string") patch.proxmoxSshUser = record.proxmoxSshUser.trim()
  const proxmoxSshPassword = nonEmptySecret(record.proxmoxSshPassword)
  if (proxmoxSshPassword !== undefined) patch.proxmoxSshPassword = proxmoxSshPassword
  if (typeof record.proxmoxSshKeyPath === "string") patch.proxmoxSshKeyPath = record.proxmoxSshKeyPath.trim()

  const current = getSettings()
  if (endpointSettingsChanged(current, patch)) {
    const confirmPassword = typeof record.confirmPassword === "string" ? record.confirmPassword : ""
    const expected = admin.session.sshPassword ?? ""
    if (!secretsMatch(confirmPassword, expected)) {
      return NextResponse.json(
        { error: "Re-enter your SSH password to change the Ludus URL or SSH host." },
        { status: 403 },
      )
    }
  }

  const updated = updateSettings(patch)
  if ("goadPath" in patch) {
    invalidateCatalogCache()
  }
  logAppEvent("settings_save", "Settings updated", {
    username: admin.session.username,
    ip: clientIpFromRequest(request),
    outcome: "success",
  })
  const response = NextResponse.json(
    toPublicSettings(updated, {
      isAdmin: true,
      rootApiKeyOverriddenByEnv: isLudusRootApiKeyEnvOverrideActive(),
    }),
  )
  return finishAdminResponse(response, admin)
}
