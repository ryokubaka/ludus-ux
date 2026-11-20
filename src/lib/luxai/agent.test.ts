import { beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"

vi.mock("@/lib/luxai/providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/luxai/providers")>("@/lib/luxai/providers")
  return { ...actual, completeProvider: vi.fn() }
})

import { completeProvider } from "@/lib/luxai/providers"
import { fitHistory, runLuxaiAgent } from "@/lib/luxai/agent"
import { bindLuxaiDbForTests, createRunIfIdle, createSession, getLuxaiSettings } from "@/lib/luxai/store"
import type { LuxaiHost } from "@/lib/luxai/tools"

const complete = vi.mocked(completeProvider)

describe("LUXAI agent loop", () => {
  beforeEach(() => {
    complete.mockReset()
    bindLuxaiDbForTests(new Database(":memory:"))
  })

  it("runs a tool and stops before any write when the tool is only a proposal", async () => {
    const writes: string[] = []
    const host: LuxaiHost = {
      listRanges: async () => [{ rangeID: "lab" }],
      readRange: async () => ({ rangeID: "lab", VMs: [] }),
      readConfig: async () => "ludus:\n  - vm_name: a\n    hostname: a\n    template: t\n    vlan: 10\n    ip_last_octet: 10\n    ram_gb: 2\n    cpus: 1\n",
      writeConfig: async (_key, _id, yaml) => { writes.push(yaml) },
      power: async () => undefined,
      deploy: async () => undefined,
      readInventory: async () => "",
      runGuest: async () => "ran",
      describeGoad: async () => "",
      listGoadCatalog: async () => "Labs: GOAD-Mini",
      createRange: async () => undefined,
      deleteRange: async () => undefined,
      fetchDoc: async () => "",
      startGoadDeploy: async () => "task",
    }
    complete
      .mockResolvedValueOnce({
        text: "I'll propose it.",
        reasoning: "",
        toolCalls: [{
          id: "call-1",
          name: "propose_range_config",
          arguments: JSON.stringify({
            rangeId: "lab",
            summary: "octet",
            yaml: "ludus:\n  - vm_name: a\n    hostname: a\n    template: t\n    vlan: 10\n    ip_last_octet: 12\n    ram_gb: 2\n    cpus: 1\n",
          }),
        }],
      })
      .mockResolvedValueOnce({ text: "Waiting for you to apply it.", reasoning: "", toolCalls: [] })

    const events: string[] = []
    const settings = getLuxaiSettings()
    settings.enabled = true
    settings.baseUrl = "http://127.0.0.1:11434/v1"
    settings.model = "local"
    settings.provider = "openai"
    settings.egress = "local"
    const answer = await runLuxaiAgent({
      settings,
      username: "alice",
      history: [],
      question: "change the octet",
      context: { username: "alice", apiKey: "k", sessionId: "s1", userText: "change the octet", host },
      onEvent: (event) => events.push(event.type),
    })
    expect(answer.text).toContain("Waiting for you")
    expect(writes).toEqual([])
    expect(events).toContain("pending")
    expect(complete).toHaveBeenCalledTimes(2)
    const firstCall = complete.mock.calls[0][0]
    expect(firstCall.apiKey).toBe("")
    expect(JSON.stringify(firstCall.messages)).toContain("change the octet")
  })

  it("lets two chats run and refuses a second run on the same chat", () => {
    const first = createSession("alice", "one").id
    const second = createSession("alice", "two").id
    expect(createRunIfIdle(first, "alice")).toBeTruthy()
    expect(createRunIfIdle(second, "alice")).toBeTruthy()
    expect(createRunIfIdle(first, "alice")).toBeNull()
  })

  it("aborts the model call on pause and continues when the run resumes", async () => {
    let status: "running" | "paused" | "stopped" = "running"
    let calls = 0
    complete.mockImplementation((req) => {
      calls += 1
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new Error("Stopped."))
          if (req.signal?.aborted) abort()
          else req.signal?.addEventListener("abort", abort, { once: true })
        })
      }
      return Promise.resolve({ text: "continued", reasoning: "", toolCalls: [] })
    })
    const pending = runLuxaiAgent(agentInput({
      control: () => ({ status, steer: "" }),
    }))
    await new Promise((resolve) => setTimeout(resolve, 40))
    status = "paused"
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(calls).toBe(1)
    status = "running"
    const answer = await pending
    expect(answer.stopped).toBe(false)
    expect(answer.text).toContain("continued")
  })

  it("aborts the model call on steer and sends that text with the next call", async () => {
    let steer = ""
    let calls = 0
    complete.mockImplementation((req) => {
      calls += 1
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new Error("Stopped."))
          if (req.signal?.aborted) abort()
          else req.signal?.addEventListener("abort", abort, { once: true })
        })
      }
      return Promise.resolve({ text: "steered", reasoning: "", toolCalls: [] })
    })
    const pending = runLuxaiAgent(agentInput({
      control: () => ({ status: "running", steer }),
      clearSteer: () => { steer = "" },
    }))
    await new Promise((resolve) => setTimeout(resolve, 40))
    steer = "use VLAN 20"
    const answer = await pending
    expect(answer.text).toContain("steered")
    expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain("use VLAN 20")
  })

  it("aborts the model call when the run is stopped", async () => {
    let status: "running" | "stopped" = "running"
    complete.mockImplementation((req) => new Promise((_resolve, reject) => {
      const abort = () => reject(new Error("Stopped."))
      if (req.signal?.aborted) abort()
      else req.signal?.addEventListener("abort", abort, { once: true })
    }))
    const pending = runLuxaiAgent(agentInput({
      control: () => ({ status, steer: "" }),
    }))
    await new Promise((resolve) => setTimeout(resolve, 40))
    status = "stopped"
    const answer = await pending
    expect(answer.stopped).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe("fitHistory", () => {
  it("keeps a long newest message instead of dropping it", () => {
    const kept = fitHistory([
      { role: "user" as const, content: "earlier" },
      { role: "assistant" as const, content: "x".repeat(50) },
    ], 20)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.role).toBe("assistant")
    expect(kept[0]?.content.startsWith("xxx")).toBe(true)
    expect(kept[0]?.content).toContain("characters omitted")
  })
})

function agentInput(extra: { control: () => { status: "running" | "paused" | "stopped"; steer: string }; clearSteer?: () => void }) {
  const host: LuxaiHost = {
    listRanges: async () => [],
    readRange: async () => ({}),
    readConfig: async () => "",
    writeConfig: async () => undefined,
    power: async () => undefined,
    deploy: async () => undefined,
    readInventory: async () => "",
    runGuest: async () => "",
    describeGoad: async () => "",
    listGoadCatalog: async () => "Labs: GOAD-Mini",
    createRange: async () => undefined,
    deleteRange: async () => undefined,
    fetchDoc: async () => "",
    startGoadDeploy: async () => "task",
  }
  const settings = getLuxaiSettings()
  settings.enabled = true
  settings.baseUrl = "http://127.0.0.1:11434/v1"
  settings.model = "local"
  settings.provider = "openai"
  settings.egress = "local"
  return {
    settings,
    username: "alice",
    history: [],
    question: "hello",
    context: { username: "alice", apiKey: "k", sessionId: "s1", userText: "hello", host },
    onEvent: () => undefined,
    ...extra,
  }
}
