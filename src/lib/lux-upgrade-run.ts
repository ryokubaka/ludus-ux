import fs from "node:fs"
import path from "node:path"
import { luxHostSelfUpdateStdin } from "@/lib/lux-host-install"
import { getLuxHostUpdateKey, getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { listKnownLuxReleaseTags } from "@/lib/lux-releases"
import { LUX_VERSION_MANAGEMENT_SINCE, losesVersionManagement, validateLuxSwitchTag } from "@/lib/lux-version"
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

const UPGRADE_SCRIPT_MAX = 524288

export const SSH_UPGRADE_NEEDS_LUX_HOST_INSTALL =
  "The one-time Settings lux-host install is required for the SSH fallback."

function signedBundledUpgradeStdin(): string {
  const key = getLuxHostUpdateKey()
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error(SSH_UPGRADE_NEEDS_LUX_HOST_INSTALL)
  }
  return luxHostSelfUpdateStdin(bundledUpgradeScript(), key)
}

function upgradeHostFailure(message: string, viaDocker: boolean): string {
  if (/update key|hmac|Settings lux-host install is required/i.test(message)) {
    return SSH_UPGRADE_NEEDS_LUX_HOST_INSTALL
  }
  return viaDocker
    ? `Could not inspect the local Docker host: ${message}`
    : `Could not inspect the LUX host: ${message}`
}

function bundledUpgradeScript(): string {
  const file = path.join(process.cwd(), "scripts", "upgrade.sh")
  const text = fs.readFileSync(file, "utf8")
  if (!text || Buffer.byteLength(text) > UPGRADE_SCRIPT_MAX) {
    throw new Error("This LUX build has no scripts/upgrade.sh to send to the host.")
  }
  return text
}

async function sshLuxHost(args: readonly string[], stdin: string): Promise<string> {
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
    args,
    { stdin },
  )
}

/**
 * Prefer the local Docker daemon. The running container is not the host, but
 * the mounted socket can start a one-shot container that enters the host
 * namespaces and starts scripts/upgrade.sh with systemd-run, so the switch
 * outlives that container. SSH is only the fallback when this process cannot
 * see the socket (LUX built without that mount). That fallback calls lux-host
 * upgrade-probe and upgrade-start with this build's scripts/upgrade.sh and an
 * HMAC from the stored update key. The socket path keeps the host shell and
 * does not need that key.
 */
async function execOnUpgradeHost(dockerScript: string, luxHostArgs: readonly string[]): Promise<string> {
  if (dockerSocketAvailable()) return runHostScriptViaDocker(dockerScript)
  return sshLuxHost(luxHostArgs, signedBundledUpgradeStdin())
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
    const repo = resolveConfiguredLuxRepoPath()
    const out = await execOnUpgradeHost(
      buildHostProbeCmd(repo),
      repo ? ["upgrade-probe", repo] : ["upgrade-probe"],
    )
    return { ...parseHostProbe(out), logTail }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Host command failed"
    return {
      canSwitch: false,
      repoPath: null,
      dirty: false,
      checkout: null,
      reason: upgradeHostFailure(message, viaDocker),
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
        `Downgrading below v${LUX_VERSION_MANAGEMENT_SINCE} removes in-app version management. Confirm that acknowledgement to continue.`,
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
    const out = await execOnUpgradeHost(
      buildStartUpgradeCmd(host.repoPath, tag),
      ["upgrade-start", host.repoPath, tag],
    )
    if (!/\bstarted\b/.test(out)) {
      return { ok: false, status: 500, error: out.trim() || "Failed to start the upgrade on the host" }
    }
    return { ok: true, tag }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start the upgrade on the host"
    if (/update key|hmac|Settings lux-host install is required/i.test(message)) {
      return { ok: false, status: 409, error: SSH_UPGRADE_NEEDS_LUX_HOST_INSTALL }
    }
    return { ok: false, status: 500, error: message }
  }
}
