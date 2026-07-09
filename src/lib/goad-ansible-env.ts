/**
 * Shell snippets for GOAD SSH sessions on the Ludus host.
 *
 * - {@link buildLudusAnsibleEnvShell} — Ansible env vars matching Ludus range deploy
 *   (collections/roles under the Ludus user tree) plus GOAD's shared `ansible/roles`
 *   (extensions' ansible.cfg `roles_path` is overridden by `ANSIBLE_ROLES_PATH`).
 * - {@link buildEnsureGoadVenvShell} — bootstrap ~/.goad/.venv + pip deps only.
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
): string {
  const root = ludusInstallPath.replace(/'/g, "")
  const goadRoot = goadPath?.replace(/'/g, "")
  // ANSIBLE_ROLES_PATH replaces ansible.cfg roles_path — must include GOAD shared
  // roles (common, commonwkstn, …) that extensions resolve via ../../../ansible/roles.
  const rolesPath = goadRoot
    ? `$_LUX_GOAD_ROOT/ansible/roles:$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/roles:$_LUX_LUDUS_ROOT/resources/global-roles:$HOME/.ansible/roles`
    : `$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/roles:$_LUX_LUDUS_ROOT/resources/global-roles:$HOME/.ansible/roles`
  return [
    `_LUX_LUDUS_ROOT='${root}'`,
    ...(goadRoot ? [`_LUX_GOAD_ROOT='${goadRoot}'`] : []),
    `_LUX_ANSIBLE_USER="$(whoami)"`,
    `_LUX_LUDUS_COLLECTIONS="$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/collections"`,
    `export ANSIBLE_HOME="$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible"`,
    `export ANSIBLE_COLLECTIONS_PATH="$_LUX_LUDUS_COLLECTIONS:$HOME/.ansible/collections:/usr/share/ansible/collections"`,
    `export ANSIBLE_ROLES_PATH="${rolesPath}"`,
    `export ANSIBLE_SSH_CONTROL_PATH_DIR="$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/cp"`,
    `mkdir -p "$ANSIBLE_HOME/collections" "$ANSIBLE_HOME/roles" "$ANSIBLE_SSH_CONTROL_PATH_DIR" 2>/dev/null || true`,
  ].join("; ")
}

/** Ensure GOAD's ~/.goad/.venv exists; pip-install GOAD root requirements on first create. */
export function buildEnsureGoadVenvShell(goadPath: string, ludusInstallPath: string): string {
  const root = goadPath.replace(/'/g, "")
  return [
    buildLudusAnsibleEnvShell(ludusInstallPath, root),
    `_LUX_PIP="$HOME/.goad/.venv/bin/pip"`,
    `_LUX_PY="$HOME/.goad/.venv/bin/python3"`,
    `_LUX_NEW_VENV=0`,
    `if [ ! -x "$_LUX_PY" ]; then python3 -m venv "$HOME/.goad/.venv"; _LUX_NEW_VENV=1; fi`,
    // One line — .join("; ") must not split `then` from its body (would emit invalid `then;`).
    `if [ -x "$_LUX_PY" ]; then _LUX_VER=$("$_LUX_PY" -c 'import sys; print(f"{sys.version_info[0]}{sys.version_info[1]:02d}{sys.version_info[2]:02d}")' 2>/dev/null || echo 0); if [ "$_LUX_VER" -ge 31100 ] 2>/dev/null; then _LUX_REQ=requirements_311.yml; else _LUX_REQ=requirements.yml; fi; if [ "$_LUX_NEW_VENV" = 1 ] && [ -f "$_LUX_GOAD_ROOT/$_LUX_REQ" ] && [ -x "$_LUX_PIP" ]; then "$_LUX_PIP" install -r "$_LUX_GOAD_ROOT/$_LUX_REQ"; fi; fi`,
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
    return `${buildLudusAnsibleEnvShell(ludusInstallPath)}; echo LUX_ANSIBLE_VERIFY_DONE`
  }

  return [
    buildLudusAnsibleEnvShell(ludusInstallPath),
    ...checks,
    `echo LUX_ANSIBLE_VERIFY_DONE`,
  ].join("; ")
}
