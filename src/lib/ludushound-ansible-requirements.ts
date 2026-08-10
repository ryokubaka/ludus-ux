/**
 * LudusHound collection (local tarball) install helpers.
 */

import "server-only"

import { fetchInstalledAnsibleServer } from "@/lib/ansible-requirements-server"
import { revalidateLudusResource } from "@/lib/ludus-cache-revalidate"
import { ensureAnsibleHomeLayoutAsRoot } from "@/lib/ansible-home-repair"
import { sshExec, type SSHCreds } from "@/lib/goad-ssh"
import { resolveLudushoundPath } from "@/lib/runtime-paths"
import {
  LUDUSHOUND_COLLECTION_NAME,
  LUDUSHOUND_COLLECTION_TARBALL,
  shellQuote,
} from "@/lib/ludushound-wizard-args"

function ansibleNameMatch(items: { name?: string; type?: string }[], want: string): boolean {
  const lower = want.toLowerCase()
  return items.some((i) => (i.name || "").toLowerCase() === lower)
}

export async function isLudushoundCollectionInstalled(apiKey: string): Promise<boolean> {
  const items = await fetchInstalledAnsibleServer(apiKey)
  return ansibleNameMatch(items, LUDUSHOUND_COLLECTION_NAME)
}

/**
 * Install bagelByt3s.ludushound from the cloned repo tarball via `ludus ansible collection add`.
 * Not on Galaxy — must use local path.
 */
export async function installLudushoundCollectionFromTarball(opts: {
  apiKey: string
  linuxUser?: string
  creds?: SSHCreds
}): Promise<{ ok: boolean; detail: string }> {
  const root = resolveLudushoundPath()
  const tarball = `${root}/Collections/${LUDUSHOUND_COLLECTION_TARBALL}`
  const user = (opts.linuxUser || opts.creds?.username || "").trim()

  const inner = [
    `test -f ${shellQuote(tarball)} || { echo "MISSING_TARBALL ${tarball}"; exit 2; }`,
    `export LUDUS_API_KEY=${shellQuote(opts.apiKey)}`,
    `ludus ansible collection add ${shellQuote(tarball)}`,
    `echo INSTALL_OK`,
  ].join(" && ")

  const cmd = user
    ? `sudo -H -u ${shellQuote(user)} bash -lc ${shellQuote(inner)}`
    : inner

  // Prefer root SSH so sudo -u works when admin impersonates
  const { stdout, stderr, code } = await sshExec(cmd, user ? undefined : opts.creds)

  if (code !== 0 || !stdout.includes("INSTALL_OK")) {
    if (/already installed/i.test(stdout + stderr)) {
      revalidateLudusResource("ansible")
      return { ok: true, detail: "Collection already installed" }
    }
    return {
      ok: false,
      detail: stderr || stdout || `collection add failed (exit ${code})`,
    }
  }

  revalidateLudusResource("ansible")
  if (user) {
    await ensureAnsibleHomeLayoutAsRoot(user)
  }
  return { ok: true, detail: `Installed ${LUDUSHOUND_COLLECTION_NAME} from ${tarball}` }
}
