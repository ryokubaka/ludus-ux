import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  asPrivilegedShell,
  formatLuxHost,
  assessConfiguredSshUser,
  buildLuxHostAuthProbeCommand,
  buildRootSshProbeCommand,
  canSubmitLuxHostInstall,
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
      sudoAll: null,
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

  it("refuses to wrap an arbitrary command for a non-root account", () => {
    expect(() => asPrivilegedShell("lux-ssh-test", "id -u")).toThrow(/arbitrary shell/)
  })
})

describe("formatLuxHost", () => {
  it("quotes each argument and does not invoke bash", () => {
    expect(formatLuxHost("lux-ssh-test", ["pvesh", "get", "/nodes"])).toBe(
      "sudo -n /usr/local/sbin/lux-host 'pvesh' 'get' '/nodes'",
    )
    expect(formatLuxHost("root", ["id"])).toBe("/usr/local/sbin/lux-host 'id'")
    expect(formatLuxHost("lux-ssh-test", ["echo", "o'brien"])).toContain("'\\''")
  })
})

describe("buildRootSshProbeCommand", () => {
  it("quotes the packer path and checks the host helper", () => {
    const cmd = buildRootSshProbeCommand("/opt/ludus/packer")
    expect(cmd).toContain("lux_root_ssh_ok")
    expect(cmd).toContain("'/opt/ludus/packer'")
    expect(cmd).toContain("sudo -n /usr/local/sbin/lux-host true")
    expect(cmd).not.toContain("NOPASSWD")
    expect(cmd).toContain("packer_writable=yes")
    expect(cmd).toContain("packer_writable=no")
  })

  it("reports passwordless sudo separately from the lux-host helper", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-ssh-probe-"))
    const bin = path.join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(
      path.join(bin, "sudo"),
      "#!/bin/sh\nif [ \"$1\" = \"-n\" ] && [ \"$2\" = \"true\" ]; then exit 0; fi\nexit 1\n",
      { mode: 0o755 },
    )
    const result = spawnSync("bash", ["-c", buildRootSshProbeCommand("/opt/ludus/packer")], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: "test" },
    })
    const parsed = parseRootSshProbe(result.stdout ?? "")
    expect(result.status).toBe(0)
    expect(parsed.sudoAll).toBe(true)
    expect(parsed.sudo).toBe(false)
  })

  it("reports passwordless lux-host when sudo -n true is denied", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-ssh-probe-helper-"))
    const bin = path.join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(
      path.join(bin, "sudo"),
      "#!/bin/sh\nif [ \"$1\" = \"-n\" ] && [ \"$2\" = \"/usr/local/sbin/lux-host\" ]; then exit 0; fi\nexit 1\n",
      { mode: 0o755 },
    )
    const result = spawnSync("bash", ["-c", buildLuxHostAuthProbeCommand()], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: "test" },
    })
    const parsed = parseRootSshProbe(result.stdout ?? "")
    expect(result.status).toBe(0)
    expect(parsed.sudo).toBe(true)
    expect(parsed.sudoAll).toBe(false)
    expect(parsed.uid).not.toBeNull()
  })

  it("reports that passwordless sudo is unavailable when sudo -n true fails", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-ssh-probe-deny-"))
    const bin = path.join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(path.join(bin, "sudo"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    const result = spawnSync("bash", ["-c", buildRootSshProbeCommand("/opt/ludus/packer")], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: "test" },
    })
    const parsed = parseRootSshProbe(result.stdout ?? "")
    expect(result.status).toBe(0)
    expect(parsed.sudoAll).toBe(false)
    expect(parsed.sudo).toBe(false)
  })
})

const account = { user: "lux", host: "ludus.local", port: 22 }

describe("canSubmitLuxHostInstall", () => {
  it("requires the Ludus host root password", () => {
    expect(canSubmitLuxHostInstall({
      installing: false,
      sshPassword: "secret",
      rootPassword: "",
      account,
      probe: {
        user: "lux",
        host: "ludus.local",
        port: 22,
        authAttempted: "private_key",
        uid: 1000,
        sudo: true,
        sudoAll: true,
      },
    })).toBe(false)
    expect(canSubmitLuxHostInstall({
      installing: false,
      sshPassword: "",
      rootPassword: "root-secret",
      account,
      probe: null,
    })).toBe(true)
  })

  it("rejects a blank root password and a submit already in progress", () => {
    expect(canSubmitLuxHostInstall({
      installing: true,
      sshPassword: "",
      rootPassword: "root-secret",
      account,
      probe: null,
    })).toBe(false)
    expect(canSubmitLuxHostInstall({
      installing: false,
      sshPassword: "secret",
      rootPassword: " ",
      account,
      probe: null,
    })).toBe(false)
  })
})
