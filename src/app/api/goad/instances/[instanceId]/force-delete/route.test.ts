import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const gate = vi.hoisted(() => ({
  instances: [] as { instanceId: string; ownerUserId: string }[],
}))

vi.mock("@/lib/session/session", () => ({ resolveSession: vi.fn() }))
vi.mock("@/lib/lux/lux-api-audit", () => ({ logLuxRouteAction: vi.fn() }))
vi.mock("@/lib/logs/app-log", () => ({ writeAppLog: vi.fn() }))
vi.mock("@/lib/settings/settings-store", () => ({ getSettings: () => ({ proxmoxSshUser: "ludus" }) }))
vi.mock("@/lib/goad/goad-task-store", () => ({ listTasks: () => [] }))
vi.mock("@/lib/ludus/ludus-client", () => ({ ludusRequest: vi.fn(async () => ({ status: 404 })) }))
vi.mock("@/lib/core/runtime-paths", () => ({ resolveGoadPath: () => "/opt/GOAD" }))
vi.mock("@/lib/core/db", () => ({ getDb: () => ({ prepare: () => ({ run: vi.fn() }) }) }))
vi.mock("@/lib/ludus/ludus-cache-revalidate", () => ({
  revalidateLudusResource: vi.fn(),
  revalidateLudusScopeResource: vi.fn(),
}))
vi.mock("@/lib/ludus/ludus-swr-invalidate", () => ({ invalidateInProcessLudusCachesAfterMutation: vi.fn() }))
vi.mock("@/lib/goad/goad-ssh", () => ({
  listGoadInstances: vi.fn(async () => gate.instances),
  readGoadRangeId: vi.fn(async () => null),
  sshExec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
  sshExecAsWorkspaceUser: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
}))

import { resolveSession } from "@/lib/session/session"
import { sshExec, sshExecAsWorkspaceUser } from "@/lib/goad/goad-ssh"
import { POST } from "./route"

function forceDelete(instanceId: string) {
  const request = new NextRequest(`http://localhost/api/goad/instances/${instanceId}/force-delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skipRangeDeletion: true }),
  })
  return POST(request, { params: Promise.resolve({ instanceId }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  gate.instances = [{ instanceId: "1a68f2-goad-mini-ludus", ownerUserId: "alice" }]
})

describe("POST /api/goad/instances/[instanceId]/force-delete", () => {
  it("refuses another user's workspace before touching it", async () => {
    vi.mocked(resolveSession).mockResolvedValue({ username: "bob", isAdmin: false, apiKey: "k" } as never)
    const res = await forceDelete("1a68f2-goad-mini-ludus")
    expect(res.status).toBe(403)
    expect(sshExecAsWorkspaceUser).not.toHaveBeenCalled()
    expect(sshExec).not.toHaveBeenCalled()
  })

  it("lets the owner delete a GOAD id that has no username prefix", async () => {
    vi.mocked(resolveSession).mockResolvedValue({ username: "alice", isAdmin: false, apiKey: "k" } as never)
    const res = await forceDelete("1a68f2-goad-mini-ludus")
    expect(res.status).toBe(200)
    expect((await res.json()).workspaceRemoved).toBe(true)
  })
})
