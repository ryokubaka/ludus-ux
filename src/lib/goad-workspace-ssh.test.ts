import { describe, expect, it } from "vitest"
import { buildWorkspaceSshExecPlan, wrapImpersonatedGoadCommand, writeGoadRangeId } from "./goad-ssh"

describe("buildWorkspaceSshExecPlan", () => {
  it("runs as the owner when they logged in with an SSH password", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      ownerSshCreds: { username: "abd6f1", password: "secret" },
      privilegedSshConfigured: true,
      callerIsAdmin: false,
      hostSshUser: "ludus",
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.command).toBe("python3 fix.py")
    expect(plan.creds?.username).toBe("abd6f1")
    expect(plan.stdin).toBeUndefined()
  })

  it("switches from a root host account to the workspace owner", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      privilegedSshConfigured: true,
      callerIsAdmin: true,
      hostSshUser: "root",
      workspaceDir: "/opt/GOAD-mod/workspace/abd6f1-goad-mini-ludus",
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.creds).toBeUndefined()
    expect(plan.stdin).toBeUndefined()
    expect(plan.command).toContain("id -u 'abd6f1'")
    expect(plan.command).toContain("sudo -H -u 'abd6f1'")
    expect(plan.command).toContain("not writable by")
    expect(plan.command).not.toMatch(/^python3 /)
  })

  it("sends the script on stdin to run-as-user when the admin host account is not root", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      privilegedSshConfigured: true,
      callerIsAdmin: true,
      hostSshUser: "ludus",
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.creds).toBeUndefined()
    expect(plan.command).toEqual(["run-as-user", "abd6f1"])
    expect(plan.stdin).toContain("python3 fix.py")
    expect(plan.stdin).toContain("id -u 'abd6f1'")
    expect(plan.stdin).not.toContain("sudo -H -u")
    expect(JSON.stringify(plan.command)).not.toContain("python3 fix.py")
  })

  it("does not run the mutation as a different host SSH user", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      ownerSshCreds: { username: "luxsvc", password: "secret" },
      privilegedSshConfigured: true,
      callerIsAdmin: true,
      hostSshUser: "root",
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.creds).toBeUndefined()
    expect(plan.command).toContain("sudo -H -u 'abd6f1'")
  })

  it("refuses a non-admin host switch", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      ownerSshCreds: { username: "luxsvc", password: "secret" },
      privilegedSshConfigured: true,
      callerIsAdmin: false,
      hostSshUser: "ludus",
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.status).toBe(403)
    expect(plan.error).toContain("abd6f1")
    expect(plan.error).toContain("SSH credentials")
  })

  it("refuses when the owner cannot be reached", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      privilegedSshConfigured: false,
      callerIsAdmin: true,
      hostSshUser: "root",
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.status).toBe(503)
    expect(plan.error).toContain("abd6f1")
  })
})

describe("wrapImpersonatedGoadCommand", () => {
  it("keeps a direct sudo switch when the host account is root", () => {
    const command = wrapImpersonatedGoadCommand("echo ok", "abd6f1", "root")
    expect(command).toContain("sudo -H -u 'abd6f1'")
    expect(command).toContain("bash -c")
    expect(command).toContain("echo ok")
    expect(command).not.toContain("run-as-user")
  })

  it("puts the script on stdin of run-as-user when the host account is not root", () => {
    const command = wrapImpersonatedGoadCommand("echo ok", "abd6f1", "ludus")
    expect(command.startsWith("sudo -n /usr/local/sbin/lux-host 'run-as-user' 'abd6f1' <<'")).toBe(true)
    expect(command).toContain("\necho ok\n")
    expect(command).not.toContain("bash -c")
    expect(command).not.toContain("sudo -H -u")
  })

  it("rejects root and a username the helper will not accept", () => {
    expect(wrapImpersonatedGoadCommand("echo ok", "root", "ludus")).toContain("exit 1")
    expect(wrapImpersonatedGoadCommand("echo ok", "root", "ludus")).not.toContain("run-as-user")
    expect(wrapImpersonatedGoadCommand("echo ok", "Bad User", "ludus")).not.toContain("sudo -H -u")
  })
})

describe("writeGoadRangeId", () => {
  it("fails when the owner command exits non-zero", async () => {
    await expect(
      writeGoadRangeId("inst-1", "alice-range", async () => ({
        stdout: "",
        stderr: "Permission denied",
        code: 1,
      })),
    ).rejects.toThrow(/Permission denied/)
  })

  it("asks the owner command to create .goad_range_id", async () => {
    let seen = ""
    await writeGoadRangeId("inst-1", "alice-range", async (command) => {
      seen = command
      return { stdout: "", stderr: "", code: 0 }
    })
    expect(seen).toContain("/.goad_range_id")
    expect(seen).toContain("alice-range")
  })
})
