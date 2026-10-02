import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const gate = vi.hoisted(() => ({
  tasks: [] as { status: string; instanceId?: string }[],
}))

vi.mock("@/lib/session", () => ({
  resolveSession: vi.fn(),
}))

vi.mock("@/lib/admin-impersonation-request", () => ({
  resolveAdminImpersonationFromRequest: vi.fn(() => ({})),
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
  chownGoadInstance: vi.fn(async () => {}),
  writeGoadRangeId: vi.fn(async () => {}),
  readGoadRangeId: vi.fn(async () => ""),
  sshExecAsWorkspaceUser: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
}))

vi.mock("@/lib/settings-store", () => ({
  getSettings: vi.fn(() => ({ proxmoxSshUser: "ludus", rootApiKey: "root-key" })),
}))

vi.mock("@/lib/ludus-client", () => ({
  ludusRequest: vi.fn(async (path: string) => {
    if (path === "/user") return { status: 200, data: { userID: "uid-alice" }, error: null }
    return { status: 201, data: {}, error: null }
  }),
  ludusRangeCreateApiKey: vi.fn(() => "root-key"),
}))

vi.mock("@/lib/ludus-user-from-profile", () => ({
  ludusCallerFromGetUser: vi.fn(() => ({ userId: "uid-alice", username: "alice" })),
}))

vi.mock("@/lib/admin-data", () => ({
  bustAdminCache: vi.fn(),
}))

vi.mock("@/lib/range-ownership-store", () => ({
  setOwnership: vi.fn(),
}))

vi.mock("@/lib/lux-api-audit", () => ({
  logLuxRouteAction: vi.fn(),
}))

vi.mock("@/lib/goad-deploy-handoff-store", () => ({
  createDeployHandoff: vi.fn(),
  linkHandoffToTask: vi.fn(),
}))

vi.mock("@/lib/root-ssh-auth", () => ({
  rootPasswordCredsIfSet: vi.fn(() => undefined),
}))

vi.mock("@/lib/goad-instance-range-store", () => ({
  setInstanceRangeLocal: vi.fn(),
}))

import { POST } from "./route"
import { resolveSession } from "@/lib/session"
import { chownGoadInstance, listGoadInstances, writeGoadRangeId } from "@/lib/goad-ssh"

const originalGoadSshUser = process.env.GOAD_SSH_USER

function call() {
  return POST(
    new NextRequest("http://localhost/api/goad/instances/inst-1/init-range", { method: "POST" }),
    { params: Promise.resolve({ instanceId: "inst-1" }) },
  )
}

beforeEach(() => {
  gate.tasks = []
  vi.clearAllMocks()
  delete process.env.GOAD_SSH_USER
  vi.mocked(resolveSession).mockResolvedValue({
    isAdmin: true,
    username: "alice",
    sshPassword: "secret",
    apiKey: "k",
  } as never)
  vi.mocked(listGoadInstances).mockResolvedValue([
    { instanceId: "inst-1", ownerUserId: "ludus" },
  ] as never)
})

afterEach(() => {
  if (originalGoadSshUser === undefined) delete process.env.GOAD_SSH_USER
  else process.env.GOAD_SSH_USER = originalGoadSshUser
})

describe("POST /api/goad/instances/[instanceId]/init-range", () => {
  it("does not chown a host-owned workspace while a fresh install has no instance id", async () => {
    gate.tasks = [{ status: "running", instanceId: "" }]
    const res = await call()
    expect(res.status).toBe(200)
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
  })

  it("chowns and writes the range file once that install has exited", async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice")
    expect(writeGoadRangeId).toHaveBeenCalled()
  })
})
