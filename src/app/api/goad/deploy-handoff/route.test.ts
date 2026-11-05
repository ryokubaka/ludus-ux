import { mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const dataDir = mkdtempSync(path.join(os.tmpdir(), "lux-handoff-"))
process.env.DATA_DIR = dataDir

const gate = vi.hoisted(() => ({
  instances: [] as { instanceId: string; ownerUserId: string }[],
  tasks: [] as { id: string; instanceId?: string; username?: string }[],
  handoffs: new Map<string, { id: string; username: string; rangeId: string; taskId?: string }>(),
  readableRanges: new Map<string, Set<string>>(),
}))

vi.mock("@/lib/session/require-session", () => ({
  requireSession: vi.fn(),
}))

vi.mock("@/lib/lux/lux-api-audit", () => ({
  logLuxRouteAction: vi.fn(),
}))

vi.mock("@/lib/logs/app-log", () => ({
  writeAppLog: vi.fn(),
}))

vi.mock("@/lib/goad/goad-ssh", () => ({
  listGoadInstances: vi.fn(async () => gate.instances),
}))

vi.mock("@/lib/goad/goad-task-store", () => ({
  listTasks: () => gate.tasks,
  getTask: (taskId: string) => gate.tasks.find((task) => task.id === taskId) ?? null,
}))

vi.mock("@/lib/settings/settings-store", () => ({
  getSettings: () => ({ proxmoxSshUser: "ludus" }),
}))

vi.mock("@/lib/ludus/ludus-client", () => ({
  ludusRequest: vi.fn(async (pathname: string, opts: { apiKey: string }) => {
    const rangeId = new URL(pathname, "http://x").searchParams.get("rangeID") ?? ""
    const ok = gate.readableRanges.get(opts.apiKey)?.has(rangeId) ?? false
    return ok ? { data: { rangeID: rangeId }, status: 200 } : { error: "Not found", status: 404 }
  }),
}))

vi.mock("@/lib/goad/goad-instance-range-store", () => ({
  setInstanceRangeLocal: vi.fn(),
}))

vi.mock("@/lib/goad/goad-deploy-handoff-store", () => ({
  createDeployHandoff: vi.fn((args: { rangeId: string; username: string }) => {
    const id = `h-${gate.handoffs.size + 1}`
    gate.handoffs.set(id, { id, username: args.username, rangeId: args.rangeId })
    return { id, ...args, createdAt: 0 }
  }),
  getHandoffById: (id: string) => gate.handoffs.get(id) ?? null,
  linkHandoffToTask: vi.fn((id: string, taskId: string) => {
    const handoff = gate.handoffs.get(id)
    if (handoff) handoff.taskId = taskId
  }),
  pruneOldHandoffs: vi.fn(),
}))

import { requireSession } from "@/lib/session/require-session"
import { setInstanceRangeLocal } from "@/lib/goad/goad-instance-range-store"
import { linkHandoffToTask } from "@/lib/goad/goad-deploy-handoff-store"
import { readPendingNetworkEnvelope } from "@/lib/goad/goad-pending-network-fs"
import { PATCH, POST } from "./route"

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function asUser(username: string, apiKey: string, isAdmin = false) {
  vi.mocked(requireSession).mockResolvedValue({
    ok: true,
    session: { username, isAdmin, apiKey, sessionId: "s", loginAt: "" },
  } as never)
}

function send(method: "POST" | "PATCH", body: Record<string, unknown>) {
  const request = new NextRequest("http://localhost/api/goad/deploy-handoff", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return method === "POST" ? POST(request) : PATCH(request)
}

const aliceRules = JSON.stringify({ rules: [{ name: "alice-allow" }] })
const bobRules = JSON.stringify({ rules: [{ name: "bob-allow-all" }] })

beforeEach(() => {
  process.env.DATA_DIR = dataDir
  vi.clearAllMocks()
  rmSync(path.join(dataDir, "pending-network"), { recursive: true, force: true })
  gate.instances = [
    { instanceId: "alice-lab", ownerUserId: "alice" },
    { instanceId: "bob-lab", ownerUserId: "bob" },
  ]
  gate.tasks = [
    { id: "task-alice", instanceId: "alice-lab", username: "alice" },
    { id: "task-bob", instanceId: "bob-lab", username: "bob" },
  ]
  gate.handoffs.clear()
  gate.readableRanges = new Map([
    ["alice-key", new Set(["alice-range"])],
    ["bob-key", new Set(["bob-range"])],
  ])
})

describe("POST /api/goad/deploy-handoff", () => {
  it("refuses another user's instance before writing anything", async () => {
    asUser("bob", "bob-key")
    const res = await send("POST", { rangeId: "bob-range", instanceId: "alice-lab", networkRules: bobRules })
    expect(res.status).toBe(403)
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
    expect(readPendingNetworkEnvelope("alice-lab")).toBeNull()
  })

  it("refuses a range the caller's Ludus key cannot read", async () => {
    asUser("bob", "bob-key")
    const res = await send("POST", { rangeId: "alice-range", instanceId: "bob-lab", networkRules: bobRules })
    expect(res.status).toBe(403)
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
    expect(readPendingNetworkEnvelope("bob-lab")).toBeNull()
  })

  it("records the owner's handoff, range link, and snapshot", async () => {
    asUser("alice", "alice-key")
    const res = await send("POST", { rangeId: "alice-range", instanceId: "alice-lab", networkRules: aliceRules })
    expect(res.status).toBe(200)
    expect(setInstanceRangeLocal).toHaveBeenCalledWith("alice-lab", "alice-range")
    expect(readPendingNetworkEnvelope("alice-lab")?.username).toBe("alice")
  })
})

describe("PATCH /api/goad/deploy-handoff", () => {
  it("refuses linking another user's handoff", async () => {
    asUser("alice", "alice-key")
    const { handoffId } = await (await send("POST", { rangeId: "alice-range" })).json()

    asUser("bob", "bob-key")
    const res = await send("PATCH", { handoffId, taskId: "task-bob" })
    expect(res.status).toBe(404)
    expect(linkHandoffToTask).not.toHaveBeenCalled()
  })

  it("refuses linking a handoff onto another user's task", async () => {
    asUser("bob", "bob-key")
    const { handoffId } = await (await send("POST", { rangeId: "bob-range" })).json()
    const res = await send("PATCH", { handoffId, taskId: "task-alice" })
    expect(res.status).toBe(404)
    expect(linkHandoffToTask).not.toHaveBeenCalled()
  })

  it("links the owner's handoff to the owner's task", async () => {
    asUser("alice", "alice-key")
    const { handoffId } = await (await send("POST", { rangeId: "alice-range" })).json()
    const res = await send("PATCH", { handoffId, taskId: "task-alice" })
    expect(res.status).toBe(200)
    expect(linkHandoffToTask).toHaveBeenCalledWith(handoffId, "task-alice")
  })
})
