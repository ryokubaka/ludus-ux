/**
 * Read Proxmox API credentials from the Ludus host the same way Ludus range
 * deploy injects PROXMOX_* for ansible.
 *
 * Sources (root SSH):
 *   - /opt/ludus/config.yml → proxmox_url, proxmox_node / proxmox_hostname
 *   - /etc/pve/priv/token.cfg → root@pam!ludus-token UUID secret
 *
 * Used when GOAD provisions extensions outside `ludus range deploy` (no env).
 */

export type LudusProxmoxDeployEnv = {
  PROXMOX_URL: string
  PROXMOX_USERNAME: string
  PROXMOX_TOKEN: string
  PROXMOX_SECRET: string
  PROXMOX_NODE: string
  PROXMOX_HOSTNAME: string
}

/** Best-effort: returns null when the host helper cannot read the Ludus token. */
export async function readLudusProxmoxDeployEnv(): Promise<LudusProxmoxDeployEnv | null> {
  // Dynamic import avoids circular dependency with goad-ssh (which calls us).
  const { sshExec } = await import("@/lib/goad-ssh")
  try {
    const { stdout, code } = await sshExec(["proxmox-token"])
    if (code !== 0) return null
    const line = stdout.trim().split("\n").filter(Boolean).pop() ?? ""
    if (!line.includes("|") || line.startsWith("ERR")) return null
    const [url, user, token, secret, node, hostname] = line.split("|")
    if (!url || !user || !token || !secret) return null
    return {
      PROXMOX_URL: url,
      PROXMOX_USERNAME: user,
      PROXMOX_TOKEN: token,
      PROXMOX_SECRET: secret,
      PROXMOX_NODE: node || "",
      PROXMOX_HOSTNAME: hostname || "127.0.0.1",
    }
  } catch {
    return null
  }
}

/** Shell `export KEY='...'` lines for GOAD / ansible-playbook inheritance. */
export function proxmoxDeployEnvExports(env: LudusProxmoxDeployEnv): string[] {
  const esc = (v: string) => v.replace(/'/g, "'\\''")
  return (Object.entries(env) as [keyof LudusProxmoxDeployEnv, string][])
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}='${esc(v)}'`)
}
