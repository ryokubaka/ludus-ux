import { describe, expect, it } from "vitest"
import {
  buildAnsibleCpPreamble,
  buildEnsureAnsibleHomeRootCmd,
  buildVerifyAnsibleHomeShell,
  formatAnsibleHomeRepairLogLine,
  resolveGoadLinuxUser,
  shellQuoteUser,
} from "@/lib/ludus-ansible-preflight"

describe("ludus-ansible-preflight", () => {
  it("shellQuoteUser escapes apostrophes", () => {
    expect(shellQuoteUser("o'brien")).toBe("o'\\''brien")
    expect(shellQuoteUser("testuser3")).toBe("testuser3")
  })

  it("buildEnsureAnsibleHomeRootCmd keeps cp/tmp ludus-owned for server range deploy", () => {
    const cmd = buildEnsureAnsibleHomeRootCmd("testuser3")
    expect(cmd).toContain("getent passwd")
    expect(cmd).toContain('chown ludus:ludus "$_HD/.ansible/cp" "$_HD/.ansible/tmp"')
    expect(cmd).toContain('chown -R "$_LU:ludus" "$_d"')
    expect(cmd).not.toContain('chown -R "$_LU:$_LU"')
  })

  it("buildEnsureAnsibleHomeRootCmd quotes usernames with apostrophes", () => {
    const cmd = buildEnsureAnsibleHomeRootCmd("pw-test")
    expect(cmd).toContain("_LU='pw-test'")
    const cmdApostrophe = buildEnsureAnsibleHomeRootCmd("o'brien")
    expect(cmdApostrophe).toContain("o'\\''brien")
  })

  it("buildVerifyAnsibleHomeShell checks ludus can write cp", () => {
    const cmd = buildVerifyAnsibleHomeShell("demouser")
    expect(cmd).toContain('sudo -u ludus test -w "$_HD/.ansible/cp"')
    expect(cmd).toContain("exit 1")
  })

  it("formatAnsibleHomeRepairLogLine describes split layout", () => {
    expect(formatAnsibleHomeRepairLogLine("demouser")).toContain("cp/tmp ludus:ludus")
    expect(formatAnsibleHomeRepairLogLine("demouser")).toContain("demouser:ludus")
    expect(formatAnsibleHomeRepairLogLine("demouser")).not.toContain("chowned everything")
  })

  it("buildAnsibleCpPreamble sets ANSIBLE_SSH_CONTROL_PATH_DIR and writability gate", () => {
    const preamble = buildAnsibleCpPreamble()
    expect(preamble).toContain('mkdir -p "$HOME/.goad/ansible-cp"')
    expect(preamble).toContain('export ANSIBLE_SSH_CONTROL_PATH_DIR="$HOME/.goad/ansible-cp"')
    expect(preamble).toContain('[ ! -w "$HOME/.goad/ansible-cp" ]')
    expect(preamble).toContain("exit 1")
  })

  it("resolveGoadLinuxUser prefers impersonation over session creds", () => {
    expect(
      resolveGoadLinuxUser({
        impersonateAs: { username: "admin" },
        creds: { username: "admin" },
      }),
    ).toBe("admin")
    expect(resolveGoadLinuxUser({ creds: { username: "alice" } })).toBe("alice")
    expect(resolveGoadLinuxUser({ sessionUsername: "melchior" })).toBe("melchior")
    expect(
      resolveGoadLinuxUser({ creds: { username: "admin" }, sessionUsername: "melchior" }),
    ).toBe("admin")
    expect(resolveGoadLinuxUser({})).toBeNull()
    expect(resolveGoadLinuxUser({ impersonateAs: { username: "  " } })).toBeNull()
  })
})
