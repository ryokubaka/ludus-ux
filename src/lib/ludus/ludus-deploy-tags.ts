/**
 * Ludus `range deploy --tags` allowlist (mirrors Range wizard).
 * Used by GOAD wizard + `/api/goad/execute` so only known tags reach the SSH wrapper.
 */

export const LUDUS_DEPLOY_TAGS = [
  "vm-deploy",
  "network",
  "dns-rewrites",
  "assign-ip",
  "windows",
  "dcs",
  "domain-join",
  "sysprep",
  "user-defined-roles",
  "custom-choco",
  "linux-packages",
  "additional-tools",
  "install-office",
  "install-visual-studio",
  "allow-share-access",
  "custom-groups",
  "share",
  "nexus",
] as const

export type LudusDeployTag = (typeof LUDUS_DEPLOY_TAGS)[number]

const ALLOW = new Set<string>(LUDUS_DEPLOY_TAGS as readonly string[])

export const LUDUS_DEPLOY_TAG_DESCRIPTIONS: Record<string, string> = {
  "vm-deploy": "Create all VMs defined in config",
  network: "Set up VLANs and firewall rules",
  "dns-rewrites": "Configure DNS rewrites",
  "assign-ip": "Set static IPs and hostnames",
  windows: "Configure Windows VMs (RDP, WinRM, etc.)",
  dcs: "Set up domain controllers",
  "domain-join": "Join Windows VMs to domain",
  sysprep: "Run sysprep on Windows VMs",
  "user-defined-roles": "Apply Ansible roles",
  "custom-choco": "Install chocolatey packages",
  "linux-packages": "Install Linux packages",
  "additional-tools": "Install Firefox, Chrome, Burp, etc.",
  "install-office": "Install Microsoft Office",
  "install-visual-studio": "Install Visual Studio",
  "allow-share-access": "Enable anonymous SMB share access",
  "custom-groups": "Set custom Ansible groups",
  share: "Deploy Ludus Share VM",
  nexus: "Deploy Nexus cache VM",
}

/** Drops unknown tags, de-dupes, preserves first-seen order. */
export function filterLudusDeployTags(tags: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    if (typeof raw !== "string") continue
    const t = raw.trim()
    if (!ALLOW.has(t) || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
