/**
 * Shell snippets for GOAD SSH sessions on the Ludus host.
 *
 * - {@link buildLudusAnsibleEnvShell} — Ansible env vars matching Ludus range deploy
 *   (collections/roles under the Ludus user tree) plus GOAD's shared `ansible/roles`
 *   (extensions' ansible.cfg `roles_path` is overridden by `ANSIBLE_ROLES_PATH`).
 * - {@link buildEnsureGoadVenvShell} — bootstrap ~/.goad/.venv + pip deps (recreate if broken).
 *
 * Galaxy roles/collections are installed via Ludus API (POST /ansible/collection,
 * POST /ansible/role) in {@link ensureGoadAnsibleRequirements} — not ansible-galaxy
 * over SSH — so installs are Ludus-tracked and visible in LUX.
 *
 * Paths must come from {@link resolveGoadPath} / {@link resolveLudusInstallPath}.
 */
export function buildLudusAnsibleEnvShell(
  ludusInstallPath: string,
  goadPath?: string,
  /** Ludus username. Collections live in /opt/ludus/users/<name>/.ansible, not $HOME. */
  ansibleUser?: string,
): string {
  const root = ludusInstallPath.replace(/'/g, "")
  const goadRoot = goadPath?.replace(/'/g, "")
  const named = ansibleUser?.trim().toLowerCase()
  const userLine =
    named && /^[a-z_][a-z0-9_-]{0,31}$/.test(named)
      ? `_LUX_ANSIBLE_USER='${named}'`
      : `_LUX_ANSIBLE_USER="$(whoami)"`
  // ANSIBLE_ROLES_PATH replaces ansible.cfg roles_path — must include GOAD shared
  // roles (common, commonwkstn, …) that extensions resolve via ../../../ansible/roles.
  const rolesPath = goadRoot
    ? `$_LUX_GOAD_ROOT/ansible/roles:$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/roles:$_LUX_LUDUS_ROOT/resources/global-roles`
    : `$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/roles:$_LUX_LUDUS_ROOT/resources/global-roles`
  return [
    `_LUX_LUDUS_ROOT='${root}'`,
    ...(goadRoot ? [`_LUX_GOAD_ROOT='${goadRoot}'`] : []),
    userLine,
    `_LUX_LUDUS_COLLECTIONS="$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/collections"`,
    `export ANSIBLE_HOME="$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible"`,
    `export ANSIBLE_COLLECTIONS_PATH="$_LUX_LUDUS_COLLECTIONS:/usr/share/ansible/collections"`,
    `export ANSIBLE_ROLES_PATH="${rolesPath}"`,
    // Controller temp must not be ANSIBLE_HOME/tmp: that dir is often mode 700
    // and owned by the ludus service account.
    `export ANSIBLE_SSH_CONTROL_PATH_DIR="$HOME/.goad/ansible-cp"`,
    `export ANSIBLE_LOCAL_TEMP="$HOME/.goad/ansible-local"`,
    `mkdir -p "$ANSIBLE_HOME/collections" "$ANSIBLE_HOME/roles" "$ANSIBLE_SSH_CONTROL_PATH_DIR" "$ANSIBLE_LOCAL_TEMP" "$HOME/.goad/ansible-remote" "$HOME/.goad/py" 2>/dev/null || true`,
    `chmod 700 "$HOME/.goad/ansible-remote" 2>/dev/null || true`,
    `chmod 700 "$ANSIBLE_LOCAL_TEMP" 2>/dev/null || true`,
    // Ansible 2.18 sizes banners with ioctl(TIOCGWINSZ), not COLUMNS. The GOAD
    // PTY is 220 columns, so task lines fill with *. Report 80 columns only
    // inside ansible processes; GOAD's own tables stay full width.
    `printf '%s\\n' 'import os, sys, fcntl, struct, termios' 'argv0 = os.path.basename(sys.argv[0] if sys.argv else "")' 'if "ansible" in argv0:' '    _real = fcntl.ioctl' '    def _ioctl(fd, op, arg=0, mutate_flag=True):' '        if op == termios.TIOCGWINSZ:' '            return struct.pack("HHHH", 24, 80, 0, 0)' '        return _real(fd, op, arg, mutate_flag)' '    fcntl.ioctl = _ioctl' > "$HOME/.goad/py/sitecustomize.py"`,
    `export PYTHONPATH="$HOME/.goad/py\${PYTHONPATH:+:\$PYTHONPATH}"`,
  ].join("; ")
}

/**
 * Ensure GOAD's ~/.goad/.venv exists and has activate + python + pip deps (incl. rich).
 * Recreates a broken/partial venv (dir present but no activate) — common goad.sh failure mode.
 */
export function buildEnsureGoadVenvShell(
  goadPath: string,
  ludusInstallPath: string,
  ansibleUser?: string,
): string {
  const root = goadPath.replace(/'/g, "")
  // Keep each `if …; then …; fi` as ONE array element so `.join("; ")` never yields `then;`.
  return [
    buildLudusAnsibleEnvShell(ludusInstallPath, root, ansibleUser),
    `mkdir -p "$HOME/.goad"`,
    `_LUX_VENV="$HOME/.goad/.venv"`,
    `_LUX_PIP="$_LUX_VENV/bin/pip"`,
    `_LUX_PY="$_LUX_VENV/bin/python3"`,
    `_LUX_ACT="$_LUX_VENV/bin/activate"`,
    `_LUX_NEW_VENV=0`,
    // Broken leftover: directory exists but activate/python missing → goad.sh skips create and fails.
    `if [ ! -f "$_LUX_ACT" ] || [ ! -x "$_LUX_PY" ]; then rm -rf "$_LUX_VENV"; python3 -m venv "$_LUX_VENV" || { echo "[-] Failed to create GOAD venv at $_LUX_VENV (install python3-venv / python3.*-venv on the Ludus host)."; exit 1; }; _LUX_NEW_VENV=1; fi`,
    `if [ ! -f "$_LUX_ACT" ] || [ ! -x "$_LUX_PY" ]; then echo "[-] GOAD venv incomplete after create ($_LUX_ACT)."; exit 1; fi`,
    `_LUX_PIP="$_LUX_VENV/bin/pip"`,
    `_LUX_PY="$_LUX_VENV/bin/python3"`,
    // Install GOAD requirements on first create OR when rich (goad.py dep) is missing.
    `if [ -x "$_LUX_PY" ]; then _LUX_VER=$("$_LUX_PY" -c 'import sys; print(f"{sys.version_info[0]}{sys.version_info[1]:02d}{sys.version_info[2]:02d}")' 2>/dev/null || echo 0); if [ "$_LUX_VER" -ge 31100 ] 2>/dev/null; then _LUX_REQ=requirements_311.yml; else _LUX_REQ=requirements.yml; fi; _LUX_NEED_PIP=0; if [ "$_LUX_NEW_VENV" = 1 ]; then _LUX_NEED_PIP=1; fi; if ! "$_LUX_PY" -c "import rich" 2>/dev/null; then _LUX_NEED_PIP=1; fi; if [ "$_LUX_NEED_PIP" = 1 ] && [ -x "$_LUX_PIP" ]; then if [ -f "$_LUX_GOAD_ROOT/$_LUX_REQ" ]; then "$_LUX_PIP" install -r "$_LUX_GOAD_ROOT/$_LUX_REQ" || { echo "[-] pip install -r $_LUX_GOAD_ROOT/$_LUX_REQ failed"; exit 1; }; else "$_LUX_PIP" install rich || { echo "[-] pip install rich failed"; exit 1; }; fi; fi; fi`,
  ].join("; ")
}

/** @deprecated Use {@link buildEnsureGoadVenvShell}. */
export const buildEnsureGoadAnsibleEnvShell = buildEnsureGoadVenvShell

/** Relative path under ansible_collections/&lt;ns&gt;/&lt;name&gt;/ proving a collection is usable on disk. */
export const GOAD_COLLECTION_CANARY_FILES: Record<string, string> = {
  "ansible.windows": "plugins/modules/win_dns_client.ps1",
  "community.windows": "plugins/modules/win_http_proxy.ps1",
}

/** SSH check that required collection plugin files exist under the Ludus user tree. */
export function buildVerifyGoadCollectionsShell(
  ludusInstallPath: string,
  collectionNames: string[],
  ansibleUser?: string,
): string {
  const checks = collectionNames
    .map((name) => {
      const rel = GOAD_COLLECTION_CANARY_FILES[name]
      if (!rel) return ""
      const [ns, col] = name.split(".")
      if (!ns || !col) return ""
      const file = `$_LUX_LUDUS_COLLECTIONS/ansible_collections/${ns}/${col}/${rel}`
      return `[ -f "${file}" ] || echo "FAIL:${name}"`
    })
    .filter(Boolean)

  if (checks.length === 0) {
    return `${buildLudusAnsibleEnvShell(ludusInstallPath, undefined, ansibleUser)}; echo LUX_ANSIBLE_VERIFY_DONE`
  }

  return [
    buildLudusAnsibleEnvShell(ludusInstallPath, undefined, ansibleUser),
    ...checks,
    `echo LUX_ANSIBLE_VERIFY_DONE`,
  ].join("; ")
}
