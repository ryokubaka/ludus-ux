/**
 * Shell helpers for Ludus Ansible home / ControlPath pre-flight on the Ludus host.
 *
 * Ludus sets per-user paths in ansible.go (range deploy):
 *   ANSIBLE_HOME=/opt/ludus/users/<ludus-username>/.ansible
 *   ANSIBLE_SSH_CONTROL_PATH_DIR=…/.ansible/cp
 * ansible-playbook runs as the `ludus` service user, not the range owner.
 * That tree is not /home/<ssh-user> and not /home/ludus.
 *
 * Galaxy installs via Ludus API often land as ludus:ludus (transient). Steady-state:
 * cp/tmp → ludus:ludus (700) so the ludus service can run range deploy.
 * roles/collections/galaxy_cache → user:ludus (770).
 * GOAD runs ansible as the range user, so it must not use that tmp directory.
 * ControlPath is ~/.goad/ansible-cp and local temp is ~/.goad/ansible-local.
 */

/** Escape a Linux username for use inside single-quoted sh strings. */
export function shellQuoteUser(user: string): string {
  return user.replace(/'/g, "'\\''")
}

/**
 * Root SSH one-liner: ensure ~/.ansible/cp+tmp are ludus-writable; galaxy tree user:ludus.
 * Does not chown cp/tmp to the range owner — that breaks Ludus server range deploy.
 */
export function buildEnsureAnsibleHomeRootCmd(linuxUser: string): readonly string[] {
  const user = linuxUser.trim()
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) {
    throw new Error("invalid linux user")
  }
  return ["ansible-home", user]
}

/** Verify Ludus server can write the range owner's ControlPath directory. */
export function buildVerifyAnsibleHomeShell(linuxUser: string): readonly string[] {
  return buildEnsureAnsibleHomeRootCmd(linuxUser)
}

/** Log line after split-layout repair (cp/tmp ludus:ludus; galaxy tree user:ludus). */
export function formatAnsibleHomeRepairLogLine(linuxUser: string): string {
  const user = linuxUser.trim()
  return `[+] Ansible home layout OK for ${user} (cp/tmp ludus:ludus; roles/collections ${user}:ludus)`
}

/**
 * User-context preamble: redirect ControlPath to ~/.goad/ansible-cp (user-writable).
 * Ludus server range deploy still uses ~/.ansible/cp (repaired as ludus:ludus above).
 */
export function buildAnsibleCpPreamble(): string {
  return [
    'mkdir -p "$HOME/.goad/ansible-cp"',
    'export ANSIBLE_SSH_CONTROL_PATH_DIR="$HOME/.goad/ansible-cp"',
    'if [ ! -w "$HOME/.goad/ansible-cp" ]; then echo "[-] Ansible control path $HOME/.goad/ansible-cp is not writable by $(whoami). Set PROXMOX_SSH_PASSWORD or mount a private key for PROXMOX_SSH_USER (./ssh) for ansible home setup."; exit 1; fi',
  ].join("; ")
}

/**
 * Ludus username whose tree is /opt/ludus/users/<name>/.ansible.
 * Impersonation wins, then the signed-in Ludus user. The host SSH account is
 * only a fallback when no Ludus username is known.
 */
export function resolveGoadLinuxUser(opts: {
  impersonateAs?: { username: string }
  creds?: { username: string }
  /** Signed-in Ludus username. API installs land in this user's Ansible tree. */
  sessionUsername?: string
}): string | null {
  const imp = opts.impersonateAs?.username?.trim()
  if (imp) return imp.toLowerCase()
  const sessionUser = opts.sessionUsername?.trim()
  if (sessionUser) return sessionUser.toLowerCase()
  const credUser = opts.creds?.username?.trim()
  if (credUser) return credUser.toLowerCase()
  return null
}
