import { afterEach, describe, expect, it } from "vitest"
import {
  asPrivilegedShell,
  assessConfiguredSshUser,
  buildRootSshProbeCommand,
  parseRootSshProbe,
  rootSshProbeProblem,
} from "./root-ssh-preflight"

describe("assessConfiguredSshUser", () => {
  const prev = process.env.GOAD_SSH_USER
  afterEach(() => {
    if (prev === undefined) delete process.env.GOAD_SSH_USER
    else process.env.GOAD_SSH_USER = prev
  })

  it("accepts root and a blank user", () => {
    delete process.env.GOAD_SSH_USER
    expect(assessConfiguredSshUser("root").isRoot).toBe(true)
    expect(assessConfiguredSshUser("").user).toBe("root")
    expect(assessConfiguredSshUser("  ").message).toBeNull()
  })

  it("does not reject a non-root settings user by name", () => {
    delete process.env.GOAD_SSH_USER
    const out = assessConfiguredSshUser("master-chief")
    expect(out.isRoot).toBe(false)
    expect(out.user).toBe("master-chief")
    expect(out.message).toBeNull()
  })

  it("lets GOAD_SSH_USER override a root settings value", () => {
    process.env.GOAD_SSH_USER = "master-chief"
    const out = assessConfiguredSshUser("root")
    expect(out.user).toBe("master-chief")
    expect(out.fromEnv).toBe(true)
    expect(out.message).toBeNull()
  })
})

describe("parseRootSshProbe", () => {
  it("parses a root login that can write the packer dir", () => {
    const out = parseRootSshProbe(
      "lux_root_ssh_ok\nuid=0\nuser=root\npacker_writable=yes\n",
    )
    expect(out).toEqual({
      loginOk: true,
      uid: 0,
      username: "root",
      sudo: null,
      packerWritable: true,
    })
    expect(rootSshProbeProblem(out, "/opt/ludus/packer")).toBeNull()
  })

  it("flags a non-root login without sudo", () => {
    const out = parseRootSshProbe(
      "lux_root_ssh_ok\nuid=1000\nuser=master-chief\nsudo=no\npacker_writable=no\n",
    )
    expect(out.uid).toBe(1000)
    expect(out.sudo).toBe(false)
    expect(rootSshProbeProblem(out, "/opt/ludus/packer")).toContain("passwordless sudo")
  })

  it("accepts a non-root login with passwordless sudo", () => {
    const out = parseRootSshProbe(
      "lux_root_ssh_ok\nuid=1006\nuser=lux-ssh-test\nsudo=yes\npacker_writable=yes\n",
    )
    expect(rootSshProbeProblem(out, "/opt/ludus/packer")).toBeNull()
  })

  it("flags an unwritable packer dir for root", () => {
    const out = parseRootSshProbe("lux_root_ssh_ok\nuid=0\nuser=root\npacker_writable=no\n")
    expect(rootSshProbeProblem(out, "/opt/ludus/packer")).toContain("not writable")
  })
})

describe("asPrivilegedShell", () => {
  it("leaves root commands unchanged", () => {
    expect(asPrivilegedShell("root", "id -u")).toBe("id -u")
  })

  it("wraps other users in the host helper, not a root shell", () => {
    expect(asPrivilegedShell("lux-ssh-test", "id -u")).toBe(
      "sudo -n /usr/local/sbin/lux-host 'id -u'",
    )
    expect(asPrivilegedShell("lux-ssh-test", "id -u")).not.toContain("bash")
  })

  it("escapes single quotes in the command", () => {
    expect(asPrivilegedShell("lux-ssh-test", "echo 'ok'")).toContain(
      "sudo -n /usr/local/sbin/lux-host ",
    )
    expect(asPrivilegedShell("lux-ssh-test", "echo 'ok'")).toContain("'\\''")
  })
})

describe("buildRootSshProbeCommand", () => {
  it("quotes the packer path and checks the host helper", () => {
    const cmd = buildRootSshProbeCommand("/opt/ludus/packer")
    expect(cmd).toContain("lux_root_ssh_ok")
    expect(cmd).toContain("'/opt/ludus/packer'")
    expect(cmd).toContain("sudo -n /usr/local/sbin/lux-host true")
    expect(cmd).not.toContain("sudo -n true")
    expect(cmd).not.toContain("NOPASSWD")
    expect(cmd).toContain("packer_writable=yes")
    expect(cmd).toContain("packer_writable=no")
  })
})
