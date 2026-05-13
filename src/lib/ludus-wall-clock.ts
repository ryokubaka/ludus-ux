/**
 * Ludus-host POSIX clock over SSH (`date +%s`, same target as GOAD ansible.log reads).
 * Bridge formats that instant in `process.env.TZ` so log prefixes stay ssh2-free in
 * client bundles.
 */

import { getSettings } from "./settings-store"
import { sshExec } from "./proxmox-ssh"
import { isRootProxmoxSshConfigured } from "./root-ssh-auth"
import { noteLudusWallClockEpoch, ludusWallClockSampleFresh } from "./ludus-wall-clock-bridge"

const THROTTLE_MS = 3000

/** Best-effort refresh over SSH (POSIX instant; displayed in `process.env.TZ`). */
export async function refreshLudusWallClockFromSsh(): Promise<void> {
  const settings = getSettings()
  if (!settings.sshHost?.trim() || !isRootProxmoxSshConfigured(settings)) return
  if (ludusWallClockSampleFresh(THROTTLE_MS)) return
  try {
    const out = await sshExec(
      settings.sshHost,
      settings.sshPort ?? 22,
      settings.proxmoxSshUser || "root",
      settings.proxmoxSshPassword || "",
      "date +%s 2>/dev/null",
    )
    noteLudusWallClockEpoch(out)
  } catch {
    /* keep previous bridge sample */
  }
}
