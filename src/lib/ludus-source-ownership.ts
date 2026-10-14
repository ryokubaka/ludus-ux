/**
 * Keep Ludus git source trees writable by the `ludus` service user.
 * Sync runs as `ludus`; root-owned `.git/objects` causes fetch permission errors.
 * Ludus UX heals ownership over root SSH before sync / on retry.
 */

import "server-only"

import { sshExec } from "@/lib/goad-ssh"
import { resolveLudusInstallPath } from "@/lib/runtime-paths"

/** True when Ludus/git reported a root-owned / unwritable source clone. */
export function isLudusSourceGitPermissionError(message: string): boolean {
  const m = message || ""
  return (
    /insufficient permission for adding an object/i.test(m) ||
    /failed to write object/i.test(m) ||
    /unpack-objects failed/i.test(m) ||
    /cannot create directory.*\.git\/objects/i.test(m)
  )
}

/**
 * Root SSH: `chown -R ludus:ludus` on `/opt/ludus/sources` (or one clone dir).
 * `cloneDirId` is Ludus PocketBase `sources.id` (filesystem folder name), not
 * the user-facing `sourceID`.
 */
export function buildRepairLudusSourcesOwnershipCmd(
  _ludusRoot: string,
  cloneDirId?: string,
): readonly string[] {
  const id = (cloneDirId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "")
  return id ? ["sources-repair", id] : ["sources-repair"]
}

/**
 * Best-effort heal. Returns true when SSH ran the chown command (exit 0).
 * No-ops quietly when root SSH is unavailable.
 */
export async function repairLudusSourcesOwnershipAsRoot(options?: {
  /** PocketBase sources.id / filesystem folder under sources/. */
  cloneDirId?: string
}): Promise<boolean> {
  try {
    const cmd = buildRepairLudusSourcesOwnershipCmd(
      resolveLudusInstallPath(),
      options?.cloneDirId,
    )
    const { code, stderr, stdout } = await sshExec(cmd)
    if (code !== 0) {
      console.warn(
        "[LUX] ludus sources ownership repair failed:",
        stderr.trim() || stdout.trim() || `exit ${code}`,
      )
      return false
    }
    return true
  } catch (err) {
    console.warn(
      "[LUX] ludus sources ownership repair skipped (host SSH?):",
      err instanceof Error ? err.message : err,
    )
    return false
  }
}
