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
    expect(cmd).toContain("sudo -S -p '' bash /tmp/lux-host-install.sh")
    expect(cmd).not.toContain("\n")
    expect(cmd).not.toMatch(/\$/)
    expect(cmd).not.toContain("secret-password")
    const b64 = /printf '%s' '([^']+)'/.exec(cmd)?.[1] ?? ""
    const script = Buffer.from(b64, "base64").toString("utf8")
    expect(script).toContain("visudo -cf")
    expect(script).toContain("mkdir -p /usr/local/sbin")
    expect(script).toContain("aGVscGVy")
    expect(script).toContain("pipefail; umask 077")
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