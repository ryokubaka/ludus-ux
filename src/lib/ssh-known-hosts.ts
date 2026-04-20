import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

/**
 * IPv4, simple hostname, or bracketed IPv6 with optional port (ssh-keygen -R accepts these).
 * Rejects shell metacharacters.
 */
export function isSafeKnownHostsHostToken(host: string): boolean {
  const t = host.trim()
  if (t.length === 0 || t.length > 253) return false
  if (/[\s'"`$&|<>;\\]/.test(t)) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return true
  if (/^\[[^\]]+\](?::\d+)?$/.test(t)) return true
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(t)
}

/** Best-effort: remove host keys from the server process's ~/.ssh/known_hosts (non-fatal on miss). */
export async function pruneKnownHostsEntries(hosts: string[]): Promise<{
  attempted: number
  /** `ssh-keygen -R` invocations that exited 0 */
  succeeded: number
}> {
  const unique = [...new Set(hosts.map((h) => h.trim()).filter(Boolean))].filter(isSafeKnownHostsHostToken)
  let succeeded = 0
  for (const host of unique) {
    try {
      await execFileAsync("ssh-keygen", ["-R", host], { timeout: 15_000, windowsHide: true })
      succeeded++
    } catch {
      // Missing entry or ssh-keygen not on PATH — ignore
    }
  }
  return { attempted: unique.length, succeeded }
}
