import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { listKnownLuxReleaseTags } from "@/lib/lux-releases"
import { losesVersionManagement, validateLuxSwitchTag } from "@/lib/lux-version"
import { dockerSocketAvailable, runHostScriptViaDocker } from "@/lib/lux-upgrade-docker"
import {
  buildHostProbeCmd,
  buildStartUpgradeCmd,
  parseHostProbe,
  readLuxUpgradeLogTail,
  resolveConfiguredLuxRepoPath,
  type LuxHostCapability,
} from "@/lib/lux-upgrade-host"

export type LuxHostStatus = LuxHostCapability & { logTail: string }

async function sshLuxHost(command: string): Promise<string> {
  const settings = getSettings()
  const host = settings.sshHost.trim()
  if (!host) {
    throw new Error("SSH host is not configured. Set LUDUS_SSH_HOST or save Settings → SSH.")
  }
  return sshExec(
    host,
    settings.sshPort || 22,
    settings.proxmoxSshUser || "root",
    settings.proxmoxSshPassword || "",
    command,
  )
}

/**
 * Prefer the local Docker daemon. The running container is not the host, but
 * the mounted socket can start a one-shot container that enters the host
 * namespaces and runs scripts/upgrade.sh. SSH is only the fallback when this
 * process cannot see the socket (LUX built without that mount).
 */
async function execOnUpgradeHost(command: string): Promise<string> {
  if (dockerSocketAvailable()) return runHostScriptViaDocker(command)
  return sshLuxHost(command)
}

export async function probeLuxUpgradeHost(): Promise<LuxHostStatus> {
  const logTail = readLuxUpgradeLogTail()
  const envRaw = (process.env.LUX_REPO_PATH ?? "").trim()
  if (envRaw && !resolveConfiguredLuxRepoPath()) {
    return {
      canSwitch: false,
      repoPath: null,
      dirty: false,
      checkout: null,
      reason: "LUX_REPO_PATH is set but is not a safe absolute path.",
      logTail,
    }
  }
  const viaDocker = dockerSocketAvailable()
  try {
    const out = await execOnUpgradeHost(buildHostProbeCmd(resolveConfiguredLuxRepoPath()))
    return { ...parseHostProbe(out), logTail }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Host command failed"
    return {
      canSwitch: false,
      repoPath: null,
      dirty: false,
      checkout: null,
      reason: viaDocker
        ? `Could not inspect the local Docker host: ${message}`
        : `Could not inspect the LUX host: ${message}`,
      logTail,
    }
  }
}

export async function startLuxUpgrade(
  tag: string,
  acknowledgeVersionManagementLoss: boolean,
): Promise<{ ok: true; tag: string } | { ok: false; status: number; error: string }> {
  const known = await listKnownLuxReleaseTags()
  const invalid = validateLuxSwitchTag(tag, known)
  if (invalid) return { ok: false, status: 400, error: invalid }
  if (losesVersionManagement(tag) && !acknowledgeVersionManagementLoss) {
    return {
      ok: false,
      status: 400,
      error:
        "Downgrading below v1.3.3 removes in-app version management. Confirm that acknowledgement to continue.",
    }
  }

  const host = await probeLuxUpgradeHost()
  if (!host.canSwitch || !host.repoPath) {
    return {
      ok: false,
      status: 409,
      error: host.reason ?? "Cannot switch versions from this host",
    }
  }

  try {
    const out = await execOnUpgradeHost(buildStartUpgradeCmd(host.repoPath, tag))
    if (!/\bstarted\b/.test(out)) {
      return { ok: false, status: 500, error: out.trim() || "Failed to start the upgrade on the host" }
    }
    return { ok: true, tag }
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "Failed to start the upgrade on the host",
    }
  }
}
