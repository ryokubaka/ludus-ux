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

  it("buildEnsureAnsibleHomeRootCmd names the lux-host operation", () => {
    expect(buildEnsureAnsibleHomeRootCmd("testuser3")).toEqual(["ansible-home", "testuser3"])
  })

  it("buildEnsureAnsibleHomeRootCmd rejects usernames that are not a login token", () => {
    expect(buildEnsureAnsibleHomeRootCmd("pw-test")).toEqual(["ansible-home", "pw-test"])
    expect(() => buildEnsureAnsibleHomeRootCmd("o'brien")).toThrow(/invalid linux user/)
  })

  it("buildVerifyAnsibleHomeShell uses the same repair operation", () => {
    expect(buildVerifyAnsibleHomeShell("demouser")).toEqual(["ansible-home", "demouser"])
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
    ).toBe("melchior")
    expect(resolveGoadLinuxUser({})).toBeNull()
    expect(resolveGoadLinuxUser({ impersonateAs: { username: "  " } })).toBeNull()
  })
})
