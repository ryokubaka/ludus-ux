import { describe, expect, it } from "vitest"
import {
  buildEnsureGoadVenvShell,
  buildLudusAnsibleEnvShell,
  buildVerifyGoadCollectionsShell,
} from "./goad-ansible-env"
import { goadPathFromEnv, ludusInstallPathFromEnv } from "./install-path-env"

describe("buildLudusAnsibleEnvShell", () => {
  it("exports Ludus per-user Ansible paths for GOAD playbook lookup", () => {
    const ludusRoot = ludusInstallPathFromEnv()
    const sh = buildLudusAnsibleEnvShell(ludusRoot)
    expect(sh).toContain(`_LUX_LUDUS_ROOT='${ludusRoot}'`)
    expect(sh).toContain('export ANSIBLE_HOME="$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible"')
    expect(sh).toContain('export ANSIBLE_COLLECTIONS_PATH="$_LUX_LUDUS_COLLECTIONS:')
    expect(sh).toContain("/users/$_LUX_ANSIBLE_USER/.ansible/collections")
    expect(sh).toContain('export ANSIBLE_SSH_CONTROL_PATH_DIR="$HOME/.goad/ansible-cp"')
    expect(sh).not.toContain(".ansible/cp")
    expect(sh).not.toContain(".goad/ansible_collections")
  })

  it("prepends GOAD shared ansible/roles when goadPath is set", () => {
    const goadRoot = goadPathFromEnv()
    const sh = buildLudusAnsibleEnvShell(ludusInstallPathFromEnv(), goadRoot)
    expect(sh).toContain(`_LUX_GOAD_ROOT='${goadRoot}'`)
    expect(sh).toContain(
      'export ANSIBLE_ROLES_PATH="$_LUX_GOAD_ROOT/ansible/roles:$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible/roles:',
    )
  })
})

describe("buildVerifyGoadCollectionsShell", () => {
  it("checks canary plugin files under Ludus collections path", () => {
    const sh = buildVerifyGoadCollectionsShell(ludusInstallPathFromEnv(), ["ansible.windows"])
    expect(sh).toContain("ansible_collections/ansible/windows/plugins/modules/win_dns_client.ps1")
    expect(sh).toContain("FAIL:ansible.windows")
    expect(sh).toContain("LUX_ANSIBLE_VERIFY_DONE")
  })
})

describe("buildEnsureGoadVenvShell", () => {
  it("bootstraps venv and pip only — no ansible-galaxy over SSH", () => {
    const goadRoot = goadPathFromEnv()
    const sh = buildEnsureGoadVenvShell(goadRoot, ludusInstallPathFromEnv())
    expect(sh).toContain(`_LUX_GOAD_ROOT='${goadRoot}'`)
    expect(sh).toContain('$_LUX_GOAD_ROOT/ansible/roles:')
    expect(sh).toContain('"$HOME/.goad/.venv"')
    expect(sh).toContain('$_LUX_VENV/bin/pip')
    expect(sh).not.toContain("ansible-galaxy")
    expect(sh).not.toContain("collection install")
  })

  it("uses venv python for pip requirements file selection", () => {
    const sh = buildEnsureGoadVenvShell(goadPathFromEnv(), ludusInstallPathFromEnv())
    expect(sh).toContain('$_LUX_PY" -c')
    expect(sh).toContain("requirements_311.yml")
  })

  it("does not emit invalid bash then; from semicolon joining", () => {
    const sh = buildEnsureGoadVenvShell(goadPathFromEnv(), ludusInstallPathFromEnv())
    expect(sh).not.toMatch(/then;\s*;/)
    expect(sh).not.toContain("then;   _LUX_VER")
  })

  it("recreates broken venv and pip-installs when rich missing", () => {
    const sh = buildEnsureGoadVenvShell(goadPathFromEnv(), ludusInstallPathFromEnv())
    expect(sh).toContain('rm -rf "$_LUX_VENV"')
    expect(sh).toContain("import rich")
    expect(sh).toContain("Failed to create GOAD venv")
    expect(sh).toContain("exit 1")
  })
})
