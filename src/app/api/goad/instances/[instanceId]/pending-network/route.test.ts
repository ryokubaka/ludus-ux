import { mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const dataDir = mkdtempSync(path.join(os.tmpdir(), "lux-pending-"))
process.env.DATA_DIR = dataDir

const gate = vi.hoisted(() => ({
  instances: [] as { instanceId: string; ownerUserId: string }[],
  tasks: [] as { instanceId?: string; username?: string }[],
}))

vi.mock("@/lib/require-session", () => ({
  requireSession: vi.fn(),
}))

vi.mock("@/lib/lux-api-audit", () => ({
  logLuxRouteAction: vi.fn(),
}))

vi.mock("@/lib/goad-ssh", () => ({
  listGoadInstances: vi.fn(async () => gate.instances),
}))

vi.mock("@/lib/goad-task-store", () => ({
  listTasks: () => gate.tasks,
}))

vi.mock("@/lib/settings-store", () => ({
  getSettings: () => ({ proxmoxSshUser: "ludus" }),
}))

vi.mock("@/lib/app-log", () => ({
  writeAppLog: vi.fn(),
}))

import { requireSession } from "@/lib/require-session"
import {
  InvalidInstanceIdError,
  pendingNetworkJsonPath,
  readPendingNetworkEnvelope,
  writePendingNetworkSnapshot,
} from "@/lib/goad-pending-network-fs"
import { DELETE, GET, POST } from "./route"

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

type SessionShape = {
  username: string
  isAdmin: boolean
  impersonationUserId?: string
  impersonationApiKey?: string
}

function asSession(session: SessionShape) {
  vi.mocked(requireSession).mockResolvedValue({
    ok: true,
    session: { apiKey: "k", sshPassword: "pw", sessionId: "s", loginAt: "", ...session },
  } as never)
}

function asUser(username: string, isAdmin = false) {
  asSession({ username, isAdmin })
}

function call(method: "GET" | "DELETE", instanceId: string) {
  const request = new NextRequest(`http://localhost/api/goad/instances/${instanceId}/pending-network`, {
    method,
  })
  const params = Promise.resolve({ instanceId })
  return method === "GET" ? GET(request, { params }) : DELETE(request, { params })
}

function store(instanceId: string, snapshot: Record<string, unknown>) {
  const request = new NextRequest(`http://localhost/api/goad/instances/${instanceId}/pending-network`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot),
  })
  return POST(request, { params: Promise.resolve({ instanceId }) })
}

describe("pending network snapshots", () => {
  beforeEach(() => {
    process.env.DATA_DIR = dataDir
    gate.instances = [{ instanceId: "alice-lab-ludus", ownerUserId: "alice" }]
    gate.tasks = []
    vi.clearAllMocks()
    rmSync(path.join(dataDir, "pending-network"), { recursive: true, force: true })
  })

  it("rejects traversal instance ids before building a path", () => {
    expect(() => pendingNetworkJsonPath("../../tmp/x")).toThrow(InvalidInstanceIdError)
    expect(() => pendingNetworkJsonPath("/tmp/x")).toThrow(InvalidInstanceIdError)
    const safe = pendingNetworkJsonPath("alice-lab-ludus")
    expect(safe.startsWith(path.resolve(dataDir))).toBe(true)
    expect(safe.endsWith(`${path.sep}alice-lab-ludus.json`)).toBe(true)
  })

  it("lets the owner read and delete, and refuses a second user", async () => {
    writePendingNetworkSnapshot("alice-lab-ludus", JSON.stringify({ vlan: 10 }), "alice")

    asUser("bob")
    const read = await call("GET", "alice-lab-ludus")
    expect(read.status).toBe(403)

    const remove = await call("DELETE", "alice-lab-ludus")
    expect(remove.status).toBe(403)

    asUser("alice")
    const owned = await call("GET", "alice-lab-ludus")
    expect(owned.status).toBe(200)
    expect(await owned.json()).toEqual({ snapshot: { vlan: 10 } })
  })

  it("refuses another user's store over an owner's snapshot, and the owner keeps it", async () => {
    writePendingNetworkSnapshot("alice-lab-ludus", JSON.stringify({ rules: [{ name: "alice" }] }), "alice")

    asUser("bob")
    const planted = await store("alice-lab-ludus", { rules: [{ name: "bob" }] })
    expect(planted.status).toBe(403)

    asUser("alice")
    const owned = await call("GET", "alice-lab-ludus")
    expect(owned.status).toBe(200)
    expect(await owned.json()).toEqual({ snapshot: { rules: [{ name: "alice" }] } })
  })

  it("refuses another user's store on an instance with no snapshot", async () => {
    asUser("bob")
    const planted = await store("alice-lab-ludus", { rules: [{ name: "bob" }] })
    expect(planted.status).toBe(403)
    expect(readPendingNetworkEnvelope("alice-lab-ludus")).toBeNull()
  })

  it("lets the workspace owner and an admin store", async () => {
    asUser("alice")
    expect((await store("alice-lab-ludus", { vlan: 10 })).status).toBe(200)
    expect(readPendingNetworkEnvelope("alice-lab-ludus")?.username).toBe("alice")

    asUser("root-admin", true)
    expect((await store("alice-lab-ludus", { vlan: 20 })).status).toBe(200)
  })

  it("stamps the impersonated user when an admin stores for them", async () => {
    asSession({
      username: "root-admin",
      isAdmin: true,
      impersonationUserId: "alice",
      impersonationApiKey: "alice-key",
    })
    expect((await store("alice-lab-ludus", { vlan: 10 })).status).toBe(200)
    expect(readPendingNetworkEnvelope("alice-lab-ludus")?.username).toBe("alice")
  })

  it("uses the task owner while GOAD still owns the workspace as the host account", async () => {
    gate.instances = [{ instanceId: "a1b2c3-goad-mini-ludus", ownerUserId: "ludus" }]
    gate.tasks = [{ instanceId: "a1b2c3-goad-mini-ludus", username: "alice" }]

    asUser("bob")
    expect((await store("a1b2c3-goad-mini-ludus", { vlan: 10 })).status).toBe(403)

    asUser("alice")
    expect((await store("a1b2c3-goad-mini-ludus", { vlan: 10 })).status).toBe(200)
  })

  it("rejects traversal on the route", async () => {
    asUser("alice")
    const res = await call("GET", "../../tmp/x")
    expect(res.status).toBe(400)
  })
})
