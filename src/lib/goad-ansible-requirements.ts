import "server-only"

import {
  parseRequirementsYaml,
  type BlueprintRequirement,
} from "@/lib/blueprint-dependencies"
import {
  findMissingAnsibleRequirementsServer,
  installMissingAnsibleRequirementsServer,
} from "@/lib/ansible-requirements-server"
import {
  buildVerifyGoadCollectionsShell,
  GOAD_COLLECTION_CANARY_FILES,
} from "@/lib/goad-ansible-env"
import { sshExec, type SSHCreds } from "@/lib/goad-ssh"
import { resolveGoadPath, resolveLudusInstallPath } from "@/lib/runtime-paths"

function wrapShellForUser(inner: string, runAsUser?: string): string {
  const user = runAsUser?.trim()
  if (!user) return inner
  return `sudo -H -u '${user.replace(/'/g, "")}' bash -lc '${inner.replace(/'/g, `'\\''`)}'`
}

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

  // GOAD install tree is often root-only (/opt/GOAD*); always read via root SSH.
  const { stdout } = await sshExec(inner, creds)
  const text = stdout.trim()
  return text || null
}

function collectionsToVerify(required: BlueprintRequirement[]): string[] {
  return required
    .filter((r) => r.kind === "collection" && r.name in GOAD_COLLECTION_CANARY_FILES)
    .map((r) => r.name)
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
  creds?: SSHCreds,
  runAsUser?: string,
  ludusInstallPath = resolveLudusInstallPath(),
): Promise<BlueprintRequirement[]> {
  const names = collectionsToVerify(required)
  if (names.length === 0) return []

  const inner = buildVerifyGoadCollectionsShell(ludusInstallPath, names)
  const { stdout } = await sshExec(wrapShellForUser(inner, runAsUser), creds)
  const brokenNames = new Set(parseBrokenCollectionNames(stdout))

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

  const required = parseRequirementsYaml(requirementsYaml)
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
    const repairResult = await installAndLog(key, broken, onLog, true, runAsUser)
    if (!repairResult.ok) return repairResult

    try {
      const stillBroken = await findBrokenGoadCollectionsOnDisk(required, creds, runAsUser)
      if (stillBroken.length > 0) {
        const ludusRoot = resolveLudusInstallPath()
        return {
          ok: false,
          error:
            `Collection still missing plugin files after force reinstall: ${stillBroken.map((b) => b.name).join(", ")}. ` +
            `Check ownership under ${ludusRoot}/users/<user>/.ansible/collections (remove broken dirs or chown to the Ludus user).`,
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Collection verify failed after force reinstall: ${msg}` }
    }
  }

  onLog("[+] GOAD Ansible dependencies ready")
  return { ok: true }
}
