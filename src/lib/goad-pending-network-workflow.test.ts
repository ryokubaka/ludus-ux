import { mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const dataDir = mkdtempSync(path.join(os.tmpdir(), "lux-pn-workflow-"))
process.env.DATA_DIR = dataDir

const gate = vi.hoisted(() => ({
  instanceRange: new Map<string, string>(),
  handoffs: new Map<string, { rangeId: string; username: string; networkRulesJson?: string }>(),
  puts: [] as { url: string; apiKey: string; body: string }[],
}))

vi.mock("@/lib/goad-instance-range-store", () => ({
  getInstanceRangeLocal: (instanceId: string) => gate.instanceRange.get(instanceId) ?? null,
}))

vi.mock("@/lib/goad-deploy-handoff-store", () => ({
  getHandoffByTaskId: (taskId: string) => gate.handoffs.get(taskId) ?? null,
}))

vi.mock("@/lib/goad-task-store", () => ({
  setTaskHasNetworkRules: vi.fn(),
  updateTaskPhase: vi.fn(),
  resolveTaskLudusApiKey: () => undefined,
}))

vi.mock("@/lib/goad-ludus-reconcile", () => ({ reconcilePbAfterFollowOnLudusDeploy: vi.fn() }))
vi.mock("@/lib/range-log-markers-store", () => ({
  insertLuxDeployTagRun: vi.fn(() => 1),
  updateLuxDeployTagRunLudusLogId: vi.fn(),
}))
vi.mock("@/lib/range-ludus-log-correlate", () => ({ correlateLudusLogIdAfterRangeAction: vi.fn() }))
vi.mock("@/lib/settings-store", () => ({ getSettings: () => ({ ludusUrl: "https://ludus.example:8080" }) }))
vi.mock("@/lib/wait-ludus-range-state", () => ({
  LUDUS_WAIT_ABSOLUTE_MAX_MS: 1,
  waitUntilLudusRangeNotDeploying: vi.fn(async () => undefined),
}))
vi.mock("@/lib/range-deploy-host-patches", () => ({ ensureRangeDeployHostPatches: vi.fn(async () => undefined) }))
vi.mock("@/lib/wait-lux-network-tag-deploy", () => ({ waitForNetworkTagDeployCompletion: vi.fn() }))
vi.mock("@/lib/ludus-router-template-assert", () => ({
  assertRouterTemplateReady: vi.fn(async () => ({ ok: false, error: "stop after config" })),
}))
vi.mock("@/lib/app-log", () => ({ writeAppLog: vi.fn() }))

vi.mock("@/lib/ludus-client", () => ({
  ludusRequest: vi.fn(async () => ({ data: { result: "ludus: []\n" }, status: 200 })),
}))

vi.mock("@/lib/ludus-fetch", () => ({
  ludusFetch: vi.fn(async (url: string, init: { headers: Record<string, string>; body: FormData }) => {
    const file = init.body.get("file") as Blob
    gate.puts.push({ url, apiKey: init.headers["X-API-KEY"], body: await file.text() })
    return new Response("{}", { status: 200 })
  }),
}))

import { writeAppLog } from "@/lib/app-log"
import { readPendingNetworkEnvelope, writePendingNetworkSnapshot } from "@/lib/goad-pending-network-fs"
import { runAfterGoadTaskCompleteIfNeeded } from "./goad-pending-network-workflow"

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function completeAliceTask() {
  return runAfterGoadTaskCompleteIfNeeded({
    taskId: "task-alice",
    command: "--repl 'use alice-lab;provide'",
    exitCode: 0,
    status: "completed",
    instanceId: "alice-lab",
    username: "alice",
    ludusApiKey: "alice-key",
  })
}

const aliceRules = { rules: [{ name: "alice-allow", action: "ACCEPT" }] }
const bobRules = { rules: [{ name: "bob-allow-all", action: "ACCEPT" }] }

beforeEach(() => {
  process.env.DATA_DIR = dataDir
  vi.clearAllMocks()
  rmSync(path.join(dataDir, "pending-network"), { recursive: true, force: true })
  gate.instanceRange = new Map([["alice-lab", "alice-range"]])
  gate.handoffs.clear()
  gate.puts = []
})

describe("runAfterGoadTaskCompleteIfNeeded", () => {
  it("does not apply another user's rules to the task owner's range", async () => {
    writePendingNetworkSnapshot("alice-lab", JSON.stringify(bobRules), "bob")
    await completeAliceTask()
    expect(gate.puts).toEqual([])
    expect(readPendingNetworkEnvelope("alice-lab")).toBeNull()
    expect(writeAppLog).toHaveBeenCalledWith(expect.objectContaining({ level: "warn" }))
  })

  it("applies the owner's rules with the owner's key", async () => {
    writePendingNetworkSnapshot("alice-lab", JSON.stringify(aliceRules), "Alice")
    await completeAliceTask()
    expect(gate.puts).toHaveLength(1)
    expect(gate.puts[0].apiKey).toBe("alice-key")
    expect(gate.puts[0].url).toContain("rangeID=alice-range")
    expect(gate.puts[0].body).toContain("alice-allow")
  })

  it("prefers the range on the task owner's handoff over the instance link", async () => {
    gate.instanceRange.set("alice-lab", "poisoned-range")
    gate.handoffs.set("task-alice", { rangeId: "alice-range", username: "alice" })
    writePendingNetworkSnapshot("alice-lab", JSON.stringify(aliceRules), "alice")
    await completeAliceTask()
    expect(gate.puts).toHaveLength(1)
    expect(gate.puts[0].url).toContain("rangeID=alice-range")
  })

  it("ignores a handoff that belongs to another user", async () => {
    gate.instanceRange.delete("alice-lab")
    gate.handoffs.set("task-alice", { rangeId: "bob-range", username: "bob", networkRulesJson: JSON.stringify(bobRules) })
    await completeAliceTask()
    expect(gate.puts).toEqual([])
  })

  it("falls back to the handoff rules when the wizard snapshot never arrived", async () => {
    gate.handoffs.set("task-alice", {
      rangeId: "alice-range",
      username: "alice",
      networkRulesJson: JSON.stringify(aliceRules),
    })
    await completeAliceTask()
    expect(gate.puts).toHaveLength(1)
    expect(gate.puts[0].body).toContain("alice-allow")
  })
})
