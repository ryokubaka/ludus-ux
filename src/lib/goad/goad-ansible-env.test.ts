import { describe, expect, it } from "vitest"
import { assertBashScript } from "@/test-support/assert-bash"
import {
  buildEnsureGoadVenvShell,
  buildLudusAnsibleEnvShell,
  buildVerifyGoadCollectionsShell,
} from "@/lib/goad/goad-ansible-env"
import { goadPathFromEnv, ludusInstallPathFromEnv } from "@/lib/settings/install-path-env"

describe("buildLudusAnsibleEnvShell", () => {
  it("exports Ludus per-user Ansible paths for GOAD playbook lookup", () => {
    const ludusRoot = ludusInstallPathFromEnv()
    const sh = buildLudusAnsibleEnvShell(ludusRoot)
    expect(sh).toContain(`_LUX_LUDUS_ROOT='${ludusRoot}'`)
    expect(sh).toContain('export ANSIBLE_HOME="$_LUX_LUDUS_ROOT/users/$_LUX_ANSIBLE_USER/.ansible"')
    expect(sh).toContain('export ANSIBLE_COLLECTIONS_PATH="$_LUX_LUDUS_COLLECTIONS:')
    expect(sh).toContain("/users/$_LUX_ANSIBLE_USER/.ansible/collections")
    expect(sh).toContain('export ANSIBLE_SSH_CONTROL_PATH_DIR="$HOME/.goad/ansible-cp"')
    expect(sh).toContain('export ANSIBLE_LOCAL_TEMP="$HOME/.goad/ansible-local"')
    expect(sh).toContain('"$HOME/.goad/ansible-remote"')
    expect(sh).toContain("termios.TIOCGWINSZ")
    expect(sh).toContain('struct.pack("HHHH", 24, 80, 0, 0)')
    expect(sh).toContain('"$HOME/.goad/py"')
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
    const sh = buildVerifyGoadCollectionsShell(ludusInstallPathFromEnv(), ["ansible.windows"], "labuser")
    expect(sh).toContain("_LUX_ANSIBLE_USER='labuser'")
    expect(sh).toContain("ansible_collections/ansible/windows/plugins/modules/win_dns_client.ps1")
    expect(sh).toContain("FAIL:ansible.windows")
    expect(sh).toContain("LUX_ANSIBLE_VERIFY_DONE")
  })

  it("checks ansible.mysql's mysql_user module and MANIFEST.json for other collections", () => {
    const sh = buildVerifyGoadCollectionsShell(
      ludusInstallPathFromEnv(),
      ["ansible.mysql", "community.mysql", "community.crypto"],
      "labuser",
    )
    expect(sh).toContain("ansible_collections/ansible/mysql/plugins/modules/mysql_user.py")
    expect(sh).toContain("FAIL:ansible.mysql")
    expect(sh).toContain("ansible_collections/community/mysql/MANIFEST.json")
    expect(sh).toContain("FAIL:community.mysql")
    expect(sh).toContain("ansible_collections/community/crypto/MANIFEST.json")
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

  it("is a script bash accepts", () => {
    const sh = buildEnsureGoadVenvShell(goadPathFromEnv(), ludusInstallPathFromEnv())
    assertBashScript(sh)
    assertBashScript(buildLudusAnsibleEnvShell(ludusInstallPathFromEnv(), goadPathFromEnv(), "labuser"))
  })

  it("recreates broken venv and pip-installs when rich missing", () => {
    const sh = buildEnsureGoadVenvShell(goadPathFromEnv(), ludusInstallPathFromEnv())
    expect(sh).toContain('rm -rf "$_LUX_VENV"')
    expect(sh).toContain("import rich")
    expect(sh).toContain("Failed to create GOAD venv")
    expect(sh).toContain("exit 1")
  })
})
