import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const gate = vi.hoisted(() => ({
  tasks: [] as { status: string; instanceId?: string }[],
  order: [] as string[],
  plans: [] as { owner?: string; callerIsAdmin?: boolean; hostSshUser?: string }[],
}))

vi.mock("@/lib/session", () => ({
  getSessionFromRequest: vi.fn(),
}))

vi.mock("@/lib/goad-task-store", () => ({
  getRunningTasksForInstance: (instanceId: string) =>
    gate.tasks.filter((task) => task.status === "running" && task.instanceId === instanceId),
  listTasks: () => gate.tasks,
  getTask: () => null,
  updateTaskInstance: vi.fn(),
}))

vi.mock("@/lib/goad-ssh", () => ({
  listGoadInstances: vi.fn(async () => []),
  chownGoadInstance: vi.fn(async () => {
    gate.order.push("chown")
  }),
  writeGoadRangeId: vi.fn(async (_instanceId: string, _rangeId: string, exec: (command: string) => Promise<unknown>) => {
    gate.order.push("write")
    await exec("printf '%s\n' range")
  }),
  buildWorkspaceSshExecPlan: vi.fn((opts: { owner?: string; callerIsAdmin?: boolean; hostSshUser?: string }) => {
    gate.plans.push(opts)
    return { ok: true, command: ["run-as-user", opts.owner], stdin: "body" }
  }),
  runWorkspaceSshPlan: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
}))

vi.mock("@/lib/goad-instance-range-store", () => ({
  setInstanceRangeLocal: vi.fn(() => {
    gate.order.push("sqlite")
  }),
}))

vi.mock("@/lib/pocketbase-client", () => ({
  setPbRangeOwner: vi.fn(async () => null),
}))

vi.mock("@/lib/admin-data", () => ({
  bustAdminCache: vi.fn(),
}))

vi.mock("@/lib/lux-api-audit", () => ({
  logLuxRouteAction: vi.fn(),
}))

vi.mock("@/lib/root-ssh-auth", () => ({
  isRootProxmoxSshConfigured: vi.fn(() => true),
  rootPasswordCredsIfSet: vi.fn(() => undefined),
}))

vi.mock("@/lib/settings-store", () => ({
  getSettings: vi.fn(() => ({ proxmoxSshUser: "ludus" })),
}))

vi.mock("@/lib/goad-deploy-handoff-store", () => ({
  createDeployHandoff: vi.fn(),
  linkHandoffToTask: vi.fn(),
}))

vi.mock("@/lib/range-ownership-store", () => ({
  setOwnership: vi.fn(),
}))

vi.mock("@/lib/ludus-client", () => ({
  ludusRequest: vi.fn(),
}))

vi.mock("@/lib/ludus-user-from-profile", () => ({
  ludusCallerFromGetUser: vi.fn(),
}))

import { POST } from "./route"
import { getSessionFromRequest } from "@/lib/session"
import { chownGoadInstance, listGoadInstances, writeGoadRangeId } from "@/lib/goad-ssh"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"

const originalGoadSshUser = process.env.GOAD_SSH_USER

function post(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/goad/instances/reassign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  gate.tasks = []
  gate.order = []
  gate.plans = []
  vi.clearAllMocks()
  delete process.env.GOAD_SSH_USER
  vi.mocked(getSessionFromRequest).mockResolvedValue({ isAdmin: true, username: "alice" } as never)
  vi.mocked(listGoadInstances).mockResolvedValue([
    { instanceId: "inst-1", ownerUserId: "ludus" },
  ] as never)
})

afterEach(() => {
  if (originalGoadSshUser === undefined) delete process.env.GOAD_SSH_USER
  else process.env.GOAD_SSH_USER = originalGoadSshUser
})

describe("POST /api/goad/instances/reassign", () => {
  it("refuses a host-owned workspace while a fresh install has no instance id", async () => {
    gate.tasks = [{ status: "running", instanceId: "" }]
    const res = await POST(post({ instanceId: "inst-1", targetUserId: "alice", rangeId: "alice-range" }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("refuses while a task already tagged with this instance is running", async () => {
    gate.tasks = [{ status: "running", instanceId: "inst-1" }]
    const res = await POST(post({ instanceId: "inst-1", targetUserId: "alice", rangeId: "alice-range" }))
    expect(res.status).toBe(409)
    expect(chownGoadInstance).not.toHaveBeenCalled()
  })

  it("refuses when the owner cannot be read while that install is running", async () => {
    gate.tasks = [{ status: "running" }]
    vi.mocked(listGoadInstances).mockRejectedValueOnce(new Error("ssh down"))
    const res = await POST(post({ instanceId: "inst-1", targetUserId: "alice", rangeId: "alice-range" }))
    expect(res.status).toBe(409)
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("chowns, writes the range file as the target, then updates SQLite after the install exits", async () => {
    gate.tasks = [{ status: "completed", instanceId: "" }]
    const res = await POST(post({ instanceId: "inst-1", targetUserId: "alice", rangeId: "alice-range" }))
    expect(res.status).toBe(200)
    expect(gate.order).toEqual(["chown", "write", "sqlite"])
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice")
    expect(gate.plans[0]).toMatchObject({
      owner: "alice",
      callerIsAdmin: true,
      hostSshUser: "ludus",
    })
    expect(setInstanceRangeLocal).toHaveBeenCalledWith("inst-1", "alice-range")
  })

  it("does not update SQLite when the owner write fails", async () => {
    vi.mocked(writeGoadRangeId).mockRejectedValueOnce(new Error("denied"))
    const res = await POST(post({ instanceId: "inst-1", targetUserId: "alice", rangeId: "alice-range" }))
    expect(res.status).toBe(207)
    expect(gate.order).toEqual(["chown"])
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("still reassigns a workspace owned by someone else during an unrelated install", async () => {
    gate.tasks = [{ status: "running", instanceId: "" }]
    vi.mocked(listGoadInstances).mockResolvedValue([
      { instanceId: "inst-1", ownerUserId: "carol" },
    ] as never)
    const res = await POST(post({ instanceId: "inst-1", targetUserId: "bob", rangeId: "bob-range" }))
    expect(res.status).toBe(200)
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "bob")
  })

  it("rejects a non-admin before any chown", async () => {
    gate.tasks = []
    vi.mocked(getSessionFromRequest).mockResolvedValue({ isAdmin: false, username: "bob" } as never)
    const res = await POST(post({ instanceId: "inst-1", targetUserId: "alice", rangeId: "alice-range" }))
    expect(res.status).toBe(403)
    expect(chownGoadInstance).not.toHaveBeenCalled()
  })
})
