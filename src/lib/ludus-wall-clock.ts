/**
 * Wall-clock HH:MM:SS from the Ludus host (same SSH target as GOAD ansible.log reads).
 * Pushes into `ludus-wall-clock-bridge.ts` so client-imported log helpers never
 * pull in ssh2 / sqlite.
 */

import { getSettings } from "./settings-store"
import { sshExec } from "./proxmox-ssh"
import { isRootProxmoxSshConfigured } from "./root-ssh-auth"
import { noteLudusWallClockSample, ludusWallClockSampleFresh } from "./ludus-wall-clock-bridge"

const THROTTLE_MS = 3000

/** Best-effort refresh over SSH (`date +%H:%M:%S` on Ludus/Proxmox host). */
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
      "date +%H:%M:%S 2>/dev/null",
    )
    noteLudusWallClockSample(out)
  } catch {
    /* keep previous bridge sample */
  }
}
