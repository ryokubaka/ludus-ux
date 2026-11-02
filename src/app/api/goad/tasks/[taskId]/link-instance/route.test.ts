import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const gate = vi.hoisted(() => ({
  instances: [] as { instanceId: string; ownerUserId: string }[],
  tasks: [] as { id: string; instanceId?: string; username?: string }[],
}))

vi.mock("@/lib/session/session", () => ({ resolveSession: vi.fn() }))
vi.mock("@/lib/lux/lux-api-audit", () => ({ logLuxRouteAction: vi.fn() }))
vi.mock("@/lib/logs/app-log", () => ({ writeAppLog: vi.fn() }))
vi.mock("@/lib/settings/settings-store", () => ({ getSettings: () => ({ proxmoxSshUser: "ludus" }) }))
vi.mock("@/lib/goad/goad-ssh", () => ({ listGoadInstances: vi.fn(async () => gate.instances) }))
vi.mock("@/lib/goad/goad-task-store", () => ({
  listTasks: () => gate.tasks,
  getTask: (taskId: string) => gate.tasks.find((task) => task.id === taskId) ?? null,
  updateTaskInstance: vi.fn(() => true),
}))

import { resolveSession } from "@/lib/session/session"
import { updateTaskInstance } from "@/lib/goad/goad-task-store"
import { POST } from "./route"

function link(taskId: string, instanceId: string) {
  const request = new NextRequest(`http://localhost/api/goad/tasks/${taskId}/link-instance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instanceId }),
  })
  return POST(request, { params: Promise.resolve({ taskId }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveSession).mockResolvedValue({ username: "bob", isAdmin: false, apiKey: "k" } as never)
  gate.instances = [
    { instanceId: "alice-lab", ownerUserId: "alice" },
    { instanceId: "a1b2c3-goad-mini-ludus", ownerUserId: "ludus" },
  ]
  gate.tasks = [
    { id: "task-bob" , username: "bob" },
    { id: "task-alice", instanceId: "alice-lab", username: "alice" },
  ]
})

describe("POST /api/goad/tasks/[taskId]/link-instance", () => {
  it("refuses linking the caller's task to another user's workspace", async () => {
    const res = await link("task-bob", "alice-lab")
    expect(res.status).toBe(403)
    expect(updateTaskInstance).not.toHaveBeenCalled()
  })

  it("links a fresh install that no task has claimed yet", async () => {
    const res = await link("task-bob", "a1b2c3-goad-mini-ludus")
    expect(res.status).toBe(200)
    expect(updateTaskInstance).toHaveBeenCalledWith("task-bob", "a1b2c3-goad-mini-ludus")
  })

  it("refuses a fresh install another user's task already claimed", async () => {
    gate.tasks.push({ id: "task-alice-2", instanceId: "a1b2c3-goad-mini-ludus", username: "alice" })
    const res = await link("task-bob", "a1b2c3-goad-mini-ludus")
    expect(res.status).toBe(403)
  })
})
