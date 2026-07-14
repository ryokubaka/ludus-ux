/**
 * Shell helpers for Ludus Ansible home / ControlPath pre-flight on the Ludus host.
 *
 * Ludus sets per-user paths in ansible.go (range deploy):
 *   ANSIBLE_HOME=/opt/ludus/users/<proxmoxUsername>/.ansible
 *   ANSIBLE_SSH_CONTROL_PATH_DIR=…/.ansible/cp
 * ansible-playbook runs as the `ludus` service user, not the range owner.
 *
 * Galaxy installs via Ludus API often land as ludus:ludus (transient). Steady-state:
 * cp/tmp → ludus:ludus (700); roles/collections/galaxy_cache → user:ludus (770).
 * GOAD user-context ansible uses ~/.goad/ansible-cp instead of ~/.ansible/cp.
 */

/** Escape a Linux username for use inside single-quoted sh strings. */
export function shellQuoteUser(user: string): string {
  return user.replace(/'/g, "'\\''")
}

/**
 * Root SSH one-liner: ensure ~/.ansible/cp+tmp are ludus-writable; galaxy tree user:ludus.
 * Does not chown cp/tmp to the range owner — that breaks Ludus server range deploy.
 */
export function buildEnsureAnsibleHomeRootCmd(linuxUser: string): string {
  const safeUser = shellQuoteUser(linuxUser.trim())
  return [
    `_LU='${safeUser}'`,
    `_HD=$(getent passwd "$_LU" 2>/dev/null | cut -d: -f6 || true)`,
    'if [ -z "$_HD" ]; then exit 0; fi',
    'mkdir -p "$_HD/.ansible/cp" "$_HD/.ansible/tmp"',
    'chown ludus:ludus "$_HD/.ansible/cp" "$_HD/.ansible/tmp"',
    'chmod 700 "$_HD/.ansible/cp" "$_HD/.ansible/tmp"',
    'for _d in "$_HD/.ansible/collections" "$_HD/.ansible/roles" "$_HD/.ansible/galaxy_cache"; do',
    '  if [ -e "$_d" ]; then chown -R "$_LU:ludus" "$_d" && chmod -R u=rwX,g=rwX,o= "$_d"; fi',
    "done",
    `[ -f "$_HD/.ansible/galaxy_token" ] && chown "$_LU:ludus" "$_HD/.ansible/galaxy_token" && chmod 660 "$_HD/.ansible/galaxy_token" || true`,
    'chmod 770 "$_HD/.ansible" 2>/dev/null || true',
  ].join("; ")
}

/** Verify Ludus server can write the range owner's ControlPath directory. */
export function buildVerifyAnsibleHomeShell(linuxUser: string): string {
  const safeUser = shellQuoteUser(linuxUser.trim())
  return [
    `_LU='${safeUser}'`,
    `_HD=$(getent passwd "$_LU" 2>/dev/null | cut -d: -f6 || true)`,
    'if [ -z "$_HD" ]; then exit 0; fi',
    'if ! sudo -u ludus test -w "$_HD/.ansible/cp" 2>/dev/null; then',
    '  echo "[-] Ludus cannot write ControlPath $_HD/.ansible/cp — configure root SSH for ansible home repair" >&2',
    "  exit 1",
    "fi",
  ].join("; ")
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
    'if [ ! -w "$HOME/.goad/ansible-cp" ]; then echo "[-] Ansible control path $HOME/.goad/ansible-cp is not writable by $(whoami). Set PROXMOX_SSH_PASSWORD or mount a root SSH key (./ssh) for ansible home setup."; exit 1; fi',
  ].join("; ")
}

/** Linux user that owns the GOAD / Ludus ansible session (impersonation wins). */
export function resolveGoadLinuxUser(opts: {
  impersonateAs?: { username: string }
  creds?: { username: string }
  /** Session Ludus username when SSH is root-only (Ludus API still installs to this user's ~/.ansible). */
  sessionUsername?: string
}): string | null {
  const imp = opts.impersonateAs?.username?.trim()
  if (imp) return imp.toLowerCase()
  const credUser = opts.creds?.username?.trim()
  if (credUser) return credUser.toLowerCase()
  const sessionUser = opts.sessionUsername?.trim()
  if (sessionUser) return sessionUser.toLowerCase()
  return null
}
