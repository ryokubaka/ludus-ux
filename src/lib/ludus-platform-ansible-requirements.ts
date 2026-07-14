import "server-only"

import {
  parseRequirementsYaml,
  type BlueprintRequirement,
} from "@/lib/blueprint-dependencies"
import {
  findMissingAnsibleRequirementsServer,
  installMissingAnsibleRequirementsServer,
} from "@/lib/ansible-requirements-server"
import { sshExec, type SSHCreds } from "@/lib/goad-ssh"
import { resolveLudusInstallPath } from "@/lib/runtime-paths"

/** Read Ludus platform ansible/requirements.yml (range deploy roles like nexus3-oss). */
export async function readLudusPlatformRequirementsYaml(
  ludusInstallPath = resolveLudusInstallPath(),
  creds?: SSHCreds,
): Promise<string | null> {
  const safeRoot = ludusInstallPath.replace(/'/g, "")
  const { stdout } = await sshExec(
    `cat '${safeRoot}/ansible/requirements.yml' 2>/dev/null || true`,
    creds,
  )
  const text = stdout.trim()
  return text || null
}

async function installAndLog(
  apiKey: string,
  items: BlueprintRequirement[],
  onLog: (line: string) => void,
  runAsUser?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: true }

  onLog(`[+] Ludus: install ${items.length} platform Ansible item(s)…`)
  for (const req of items) {
    const name = `${req.kind} ${req.name}${req.version ? `@${req.version}` : ""}`
    onLog(`[+] Ludus: install ${name}`)
  }

  const result = await installMissingAnsibleRequirementsServer(apiKey, items, {
    linuxUser: runAsUser,
  })
  for (const name of result.installed) {
    onLog(`[+] Installed (or already present): ${name}`)
  }
  for (const fail of result.failed) {
    onLog(`[-] Failed to install ${fail.name}: ${fail.error}`)
  }

  if (!result.ok) {
    const first = result.failed[0]
    return {
      ok: false,
      error: first ? `${first.name}: ${first.error}` : "Ludus platform Ansible install failed",
    }
  }
  return { ok: true }
}

/**
 * Ensure /opt/ludus/ansible/requirements.yml roles+collections are installed for the
 * session user before range deploy (includes ansible-thoteam.nexus3-oss for ludus.yml).
 */
export async function ensureLudusPlatformAnsibleRequirements(
  apiKey: string,
  creds: SSHCreds | undefined,
  onLog: (line: string) => void,
  ludusInstallPath = resolveLudusInstallPath(),
  runAsUser?: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey.trim()
  if (!key) {
    onLog("[!] No Ludus API key — skipping Ludus platform Ansible dependency install")
    return { ok: true }
  }

  let requirementsYaml: string | null
  try {
    requirementsYaml = await readLudusPlatformRequirementsYaml(ludusInstallPath, creds)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onLog(`[!] Could not read Ludus platform ansible requirements over SSH: ${msg}`)
    return { ok: true }
  }

  if (!requirementsYaml) {
    onLog("[!] Ludus ansible/requirements.yml not found — skipping platform Ansible install")
    return { ok: true }
  }

  const required = parseRequirementsYaml(requirementsYaml)
  if (required.length === 0) {
    return { ok: true }
  }

  onLog("[+] Checking Ludus platform Ansible dependencies (Ludus API)…")

  let missing: BlueprintRequirement[]
  try {
    missing = await findMissingAnsibleRequirementsServer(key, required)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Ludus GET /ansible failed: ${msg}` }
  }

  if (missing.length > 0) {
    onLog(`[+] Installing ${missing.length} missing Ludus platform Ansible item(s)…`)
    const installResult = await installAndLog(key, missing, onLog, runAsUser)
    if (!installResult.ok) return installResult
  } else {
    onLog("[+] Ludus platform Ansible dependencies listed in Ludus")
  }

  return { ok: true }
}
