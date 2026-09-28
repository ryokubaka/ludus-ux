import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildLuxHostInstallShell,
  explainLuxHostInstallFailure,
  luxHostSudoUsernameError,
  renderLuxHostSudoers,
} from "./lux-host-install"

const TEMPLATE = "# comment\n__LUX_SSH_USER__ ALL=(root) NOPASSWD: LUX_HOST\n"

describe("lux-host-install", () => {
  it("accepts a plain username and rejects root or metacharacters", () => {
    expect(luxHostSudoUsernameError("user")).toBeNull()
    expect(luxHostSudoUsernameError("root")).toMatch(/root/)
    expect(luxHostSudoUsernameError("user;rm")).toMatch(/plain Linux/)
    expect(luxHostSudoUsernameError("User")).toMatch(/plain Linux/)
  })

  it("substitutes only the sudoers user", () => {
    expect(renderLuxHostSudoers(TEMPLATE, "user")).toBe("# comment\nuser ALL=(root) NOPASSWD: LUX_HOST\n")
    expect(renderLuxHostSudoers(TEMPLATE, "user")).not.toContain("__LUX_SSH_USER__")
  })

  it("builds a visudo install with no shell expansions in the transmitted command", () => {
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "sudo-s")
    expect(cmd).not.toContain("\n")
    expect(cmd).not.toMatch(/\$/)
    expect(cmd).not.toContain("secret-password")
    const wrapper = Buffer.from(/printf '%s' '([^']+)'/.exec(cmd)?.[1] ?? "", "base64").toString("utf8")
    expect(wrapper).toContain("sudo -S -p '' bash /tmp/lux-host-install.sh")
    expect(wrapper).toContain("exit $status")
    const script = Buffer.from(/printf '%s' '([^']+)'/.exec(wrapper)?.[1] ?? "", "base64").toString("utf8")
    expect(script).toContain("visudo -cf")
    expect(script).toContain("mkdir -p /usr/local/sbin")
    expect(script).toContain("aGVscGVy")
    expect(script).toContain("pipefail; umask 077")
  })

  it("returns the installer status when sudo fails and deletes the temp script", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-host-install-"))
    writeFileSync(path.join(dir, "sudo"), "#!/bin/sh\nexit 17\n", { mode: 0o755 })
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "sudo-n")
    const wrapped = `bash -c ${JSON.stringify(cmd)}`
    const result = spawnSync("sh", ["-c", wrapped], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, status: "0" },
    })
    expect(result.status).toBe(17)
    expect(existsSync("/tmp/lux-host-install.sh")).toBe(false)
    expect(existsSync("/tmp/lux-host-install.wrap")).toBe(false)
  })

  it("returns non-zero when the root installer cannot write the helper", () => {
    const cmd = buildLuxHostInstallShell(
      Buffer.from("#!/bin/sh\n").toString("base64"),
      Buffer.from("user ALL=(root) NOPASSWD: /usr/local/sbin/lux-host\n").toString("base64"),
      "root",
    )
    const result = spawnSync("bash", ["-c", cmd], { encoding: "utf8" })
    expect(result.status).not.toBe(0)
    expect(existsSync("/tmp/lux-host-install.sh")).toBe(false)
    expect(existsSync("/tmp/lux-host-install.wrap")).toBe(false)
  })

  it("explains a user that is absent from sudoers", () => {
    expect(explainLuxHostInstallFailure("user is not in the sudoers file. This incident will be reported to the administrator.", "user"))
      .toMatch(/cannot install this rule/)
  })

  it("omits sudo when the SSH account is already root", () => {
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "root")
    expect(cmd.startsWith("printf ")).toBe(true)
    expect(cmd).not.toContain("sudo")
  })
})