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

const READ_PY = `
import yaml, sys
cfg = yaml.safe_load(open("/opt/ludus/config.yml"))
url = str(cfg.get("proxmox_url") or "").rstrip("/")
node = str(cfg.get("proxmox_node") or cfg.get("proxmox_hostname") or "").strip()
host = str(cfg.get("proxmox_hostname") or node or "127.0.0.1").strip()
token_id = "root@pam!ludus-token"
secret = ""
try:
    with open("/etc/pve/priv/token.cfg") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 2 and parts[0] == token_id:
                secret = parts[1]
                break
except Exception as e:
    print("ERR read token.cfg: " + str(e), file=sys.stderr)
    sys.exit(2)
if not url or not secret:
    print("ERR missing proxmox_url or token secret", file=sys.stderr)
    sys.exit(3)
# one line: url|user|token|secret|node|hostname
print("|".join([url, "root@pam", token_id, secret, node, host]))
`

/** Best-effort: returns null when root SSH / files unavailable. */
export async function readLudusProxmoxDeployEnv(): Promise<LudusProxmoxDeployEnv | null> {
  // Dynamic import avoids circular dependency with goad-ssh (which calls us).
  const { sshExec } = await import("@/lib/goad-ssh")
  const encoded = Buffer.from(READ_PY, "utf-8").toString("base64")
  const cmd = `echo '${encoded}' | base64 -d | python3 -`
  try {
    // Default sshExec uses root credentials from settings / key mount.
    const { stdout, code } = await sshExec(cmd)
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
