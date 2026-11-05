import "server-only"

import {
  applyLudusVersionPins,
  parseRequirementsYaml,
  type BlueprintRequirement,
} from "@/lib/blueprints/blueprint-dependencies"
import {
  findMissingAnsibleRequirementsServer,
  findWrongVersionAnsibleRequirementsServer,
  installMissingAnsibleRequirementsServer,
} from "@/lib/ansible/ansible-requirements-server"
import { readLudusPlatformRequirementsYaml } from "@/lib/ludus/ludus-platform-ansible-requirements"
import { goadCollectionCanaryRel } from "@/lib/goad/goad-ansible-env"
import { sshExec, sshExecAccount, type SSHCreds } from "@/lib/goad/goad-ssh"
import { resolveGoadPath, resolveLudusInstallPath } from "@/lib/core/runtime-paths"

/** Read GOAD ansible/requirements*.yml from the Ludus host (matches GOAD venv Python version when present). */
export async function readGoadAnsibleRequirementsYaml(
  goadPath: string,
  creds?: SSHCreds,
): Promise<string | null> {
  const safeRoot = goadPath.replace(/'/g, "")
  const inner = [
    `G='${safeRoot}/ansible'`,
    `PY="$HOME/.goad/.venv/bin/python3"`,
    `if [ -x "$PY" ]; then V=$("$PY" -c 'import sys; print(f"{sys.version_info[0]}{sys.version_info[1]:02d}{sys.version_info[2]:02d}")' 2>/dev/null || echo 0); else V=$(python3 -c 'import sys; print(f"{sys.version_info[0]}{sys.version_info[1]:02d}{sys.version_info[2]:02d}")' 2>/dev/null || echo 0); fi`,
    `if [ "$V" -ge 31100 ] 2>/dev/null; then F=requirements_311.yml; else F=requirements.yml; fi`,
    `cat "$G/$F" 2>/dev/null || true`,
  ].join("; ")

  const { stdout } = creds ? await sshExec(inner, creds) : await sshExecAccount(inner)
  const text = stdout.trim()
  return text || null
}

function collectionsToVerify(required: BlueprintRequirement[]): string[] {
  return required.filter((r) => r.kind === "collection" && goadCollectionCanaryRel(r.name)).map((r) => r.name)
}

/** community.mysql 5.x is a redirect stub. glpi.yml's mysql_user lives in ansible.mysql. */
function withMysqlModuleCollection(required: BlueprintRequirement[]): BlueprintRequirement[] {
  const needsMysql = required.some((r) => r.kind === "collection" && r.name === "community.mysql")
  const hasModule = required.some((r) => r.kind === "collection" && r.name === "ansible.mysql")
  if (!needsMysql || hasModule) return required
  return [...required, { kind: "collection", name: "ansible.mysql" }]
}

function parseBrokenCollectionNames(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("FAIL:"))
    .map((line) => line.slice("FAIL:".length).trim())
    .filter(Boolean)
}

/** Collections Ludus lists as installed but missing canary plugin files on disk. */
export async function findBrokenGoadCollectionsOnDisk(
  required: BlueprintRequirement[],
  _creds?: SSHCreds,
  runAsUser?: string,
  _ludusInstallPath = resolveLudusInstallPath(),
): Promise<BlueprintRequirement[]> {
  const names = collectionsToVerify(required)
  const user = runAsUser?.trim().toLowerCase()
  if (names.length === 0 || !user) return []

  const brokenNames = new Set<string>()
  for (const name of names) {
    const rel = goadCollectionCanaryRel(name)
    const [ns, col] = name.split(".")
    if (!rel || !ns || !col) continue
    const { stdout } = await sshExec(["ansible-collection-file", user, ns, col, rel])
    for (const line of parseBrokenCollectionNames(stdout)) brokenNames.add(line)
  }

  return required.filter((r) => r.kind === "collection" && brokenNames.has(r.name))
}

async function installAndLog(
  apiKey: string,
  items: BlueprintRequirement[],
  onLog: (line: string) => void,
  force: boolean,
  runAsUser?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: true }

  const label = force ? "force reinstall" : "install"
  onLog(`[+] Ludus: ${label} ${items.length} Ansible item(s)…`)
  for (const req of items) {
    const name = `${req.kind} ${req.name}${req.version ? `@${req.version}` : ""}`
    onLog(`[+] Ludus: ${label} ${name}`)
  }

  const result = await installMissingAnsibleRequirementsServer(apiKey, items, {
    force,
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
      error: first ? `${first.name}: ${first.error}` : "Ansible dependency install failed",
    }
  }
  return { ok: true }
}

/**
 * Ensure GOAD's ansible/requirements*.yml roles+collections are installed via Ludus API
 * before goad.sh runs (same endpoints as the LUX Ansible page).
 */
export async function ensureGoadAnsibleRequirements(
  apiKey: string,
  creds: SSHCreds | undefined,
  onLog: (line: string) => void,
  goadPath = resolveGoadPath(),
  runAsUser?: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey.trim()
  if (!key) {
    onLog("[!] No Ludus API key — skipping GOAD Ansible dependency install via Ludus API")
    return { ok: true }
  }

  let requirementsYaml: string | null
  try {
    requirementsYaml = await readGoadAnsibleRequirementsYaml(goadPath, creds)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onLog(`[!] Could not read GOAD ansible requirements over SSH: ${msg}`)
    return { ok: true }
  }

  if (!requirementsYaml) {
    onLog("[!] GOAD ansible/requirements*.yml not found — skipping Ludus Ansible install")
    return { ok: true }
  }

  let pins: BlueprintRequirement[] = []
  try {
    pins = parseRequirementsYaml(await readLudusPlatformRequirementsYaml())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onLog(`[!] Could not read Ludus collection pins: ${msg}`)
  }
  const parsed = withMysqlModuleCollection(parseRequirementsYaml(requirementsYaml))
  const required = applyLudusVersionPins(parsed, pins)
  for (const req of required) {
    const original = parsed.find((item) => item.kind === req.kind && item.name === req.name)
    if (req.version && req.version !== original?.version) {
      onLog(`[+] Using Ludus pin ${req.name}@${req.version}`)
    }
  }
  if (required.length === 0) {
    return { ok: true }
  }

  onLog("[+] Checking GOAD Ansible dependencies (Ludus API)…")

  let missing: BlueprintRequirement[]
  try {
    missing = await findMissingAnsibleRequirementsServer(key, required)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Ludus GET /ansible failed: ${msg}` }
  }

  if (missing.length > 0) {
    onLog(`[+] Installing ${missing.length} missing Ansible item(s) via Ludus API…`)
    const installResult = await installAndLog(key, missing, onLog, false, runAsUser)
    if (!installResult.ok) return installResult
  } else {
    onLog("[+] GOAD Ansible dependencies listed in Ludus")
  }

  let wrongVersion: BlueprintRequirement[] = []
  try {
    wrongVersion = await findWrongVersionAnsibleRequirementsServer(key, required)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Ludus GET /ansible failed: ${msg}` }
  }
  if (wrongVersion.length > 0) {
    const pinned = await installAndLog(key, wrongVersion, onLog, true, runAsUser)
    if (!pinned.ok) return pinned
  }

  let broken: BlueprintRequirement[] = []
  try {
    broken = await findBrokenGoadCollectionsOnDisk(required, creds, runAsUser)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onLog(`[!] Could not verify collection files on disk: ${msg}`)
  }

  if (broken.length > 0) {
    onLog(
      `[!] Incomplete collection(s) on disk (Ludus inventory can lie after a failed install): ${broken.map((b) => b.name).join(", ")}`,
    )
    const user = runAsUser?.trim().toLowerCase()
    const unresolved: BlueprintRequirement[] = []
    if (user) {
      onLog("[+] Repairing collection ownership and reinstalling on the Ludus host…")
      for (const req of broken) {
        const rel = goadCollectionCanaryRel(req.name)
        const [ns, col] = req.name.split(".")
        if (!rel || !ns || !col) {
          unresolved.push(req)
          continue
        }
        onLog(`[+] Repairing collection ${req.name}`)
        const repaired = await sshExec(["ansible-collection-repair", user, ns, col, rel])
        const reason = repaired.stderr.trim()
        if (reason) onLog(`[!] ${req.name}: ${reason}`)
        const ok = repaired.stdout.split("\n").some((line) => line.trim() === `OK:${req.name}`)
        if (!ok) unresolved.push(req)
      }
    } else {
      unresolved.push(...broken)
    }

    if (unresolved.length > 0) {
      const repairResult = await installAndLog(key, unresolved, onLog, true, runAsUser)
      if (!repairResult.ok) return repairResult
    }

    try {
      const stillBroken = await findBrokenGoadCollectionsOnDisk(required, creds, runAsUser)
      if (stillBroken.length > 0) {
        const ludusRoot = resolveLudusInstallPath()
        const error =
          `Collection still missing plugin files after repair: ${stillBroken.map((b) => b.name).join(", ")}. ` +
          `Expected under ${ludusRoot}/users/${user ?? "<user>"}/.ansible/collections/ansible_collections.`
        onLog(`[-] ${error}`)
        return { ok: false, error }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Collection verify failed after repair: ${msg}` }
    }
  }

  onLog("[+] GOAD Ansible dependencies ready")
  return { ok: true }
}
