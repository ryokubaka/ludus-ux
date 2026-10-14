import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const gate = vi.hoisted(() => ({
  tasks: [] as { status: string; instanceId?: string }[],
  order: [] as string[],
}))

vi.mock("@/lib/session", () => ({
  resolveSession: vi.fn(),
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
  writeGoadRangeId: vi.fn(async () => {
    gate.order.push("write")
  }),
  sshExecAsWorkspaceUser: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
  workspaceOwnerLinuxUser: vi.fn(() => "alice"),
}))

vi.mock("@/lib/goad-instance-range-store", () => ({
  setInstanceRangeLocal: vi.fn(() => {
    gate.order.push("sqlite")
  }),
}))

vi.mock("@/lib/lux-api-audit", () => ({
  logLuxRouteAction: vi.fn(),
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

vi.mock("@/lib/root-ssh-auth", () => ({
  rootPasswordCredsIfSet: vi.fn(() => undefined),
}))

import { POST } from "./route"
import { resolveSession } from "@/lib/session"
import { chownGoadInstance, listGoadInstances } from "@/lib/goad-ssh"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"

const originalGoadSshUser = process.env.GOAD_SSH_USER

function post(instanceIds: string[]) {
  return new NextRequest("http://localhost/api/goad/instances/set-range", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rangeId: "alice-range", instanceIds }),
  })
}

beforeEach(() => {
  gate.tasks = []
  gate.order = []
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

describe("POST /api/goad/instances/set-range", () => {
  it("does not chown a host-owned workspace while a fresh install has no instance id", async () => {
    gate.tasks = [{ status: "running", instanceId: "" }]
    const res = await POST(post(["inst-1"]))
    expect(res.status).toBe(207)
    const body = await res.json()
    expect(body.results[0]).toMatchObject({ instanceId: "inst-1", ok: false })
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("chowns, writes the range file, then updates SQLite after that install exits", async () => {
    const res = await POST(post(["inst-1"]))
    expect(res.status).toBe(200)
    expect(gate.order).toEqual(["chown", "write", "sqlite"])
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice")
    expect(setInstanceRangeLocal).toHaveBeenCalledWith("inst-1", "alice-range")
  })
})
