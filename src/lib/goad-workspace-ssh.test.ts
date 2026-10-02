import { describe, expect, it } from "vitest"
import { buildWorkspaceSshExecPlan } from "./goad-ssh"

describe("buildWorkspaceSshExecPlan", () => {
  it("runs as the owner when they logged in with an SSH password", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      ownerSshCreds: { username: "abd6f1", password: "secret" },
      privilegedSshConfigured: true,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.command).toBe("python3 fix.py")
    expect(plan.creds?.username).toBe("abd6f1")
  })

  it("switches from the privileged host account to the workspace owner", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      privilegedSshConfigured: true,
      workspaceDir: "/opt/GOAD-mod/workspace/abd6f1-goad-mini-ludus",
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.creds).toBeUndefined()
    expect(plan.command).toContain("id -u 'abd6f1'")
    expect(plan.command).toContain("sudo -H -u 'abd6f1'")
    expect(plan.command).toContain("not writable by")
    expect(plan.command).not.toMatch(/^python3 /)
  })

  it("does not run the mutation as a different host SSH user", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      ownerSshCreds: { username: "luxsvc", password: "secret" },
      privilegedSshConfigured: true,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.creds).toBeUndefined()
    expect(plan.command).toContain("sudo -H -u 'abd6f1'")
  })

  it("refuses when the owner cannot be reached", () => {
    const plan = buildWorkspaceSshExecPlan({
      owner: "abd6f1",
      innerCommand: "python3 fix.py",
      privilegedSshConfigured: false,
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.status).toBe(503)
    expect(plan.error).toContain("abd6f1")
  })
})
