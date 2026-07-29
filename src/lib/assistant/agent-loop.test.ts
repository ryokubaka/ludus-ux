import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RuntimeSettings } from "../settings-store"

vi.mock("../settings-store", () => ({
  getSettings: vi.fn(),
}))

vi.mock("./llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm-client")>()
  return {
    ...actual,
    llmFetch: vi.fn(),
    llmStreamChat: vi.fn(),
  }
})

vi.mock("./tool-executor", () => ({
  executeAssistantTool: vi.fn(),
}))

vi.mock("./skill-loader", () => ({
  loadLudusUxSkillContext: () => "skill-context",
}))

import { getSettings } from "../settings-store"
import { llmFetch, llmStreamChat } from "./llm-client"
import { executeAssistantTool } from "./tool-executor"
import { runAssistantAgent } from "./agent-loop"

function mockSettings(overrides: Partial<RuntimeSettings> = {}): void {
  vi.mocked(getSettings).mockReturnValue({
    ludusUrl: "",
    ludusAdminUrl: "",
    sshHost: "",
    sshPort: 22,
    goadPath: "/opt/GOAD",
    ludusInstallPath: "/opt/ludus",
    goadEnabled: true,
    ludusAnsibleVerbose: true,
    rootApiKey: "",
    blueprintOperatorApiKey: "",
    blueprintOperatorUserId: "",
    proxmoxSshUser: "root",
    proxmoxSshPassword: "",
    proxmoxSshKeyPath: "",
    aiAssistantEnabled: true,
    llmBaseUrl: "http://llm/v1",
    llmApiKey: "",
    llmModel: "qwen2.5:14b",
    ...overrides,
  } satisfies RuntimeSettings)
}

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

function withoutStatus(events: unknown[]): unknown[] {
  return events.filter((e) => (e as { type?: string }).type !== "status")
}

function mockStreamMessage(message: {
  content?: string | null
  thinking?: string
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>
}) {
  vi.mocked(llmStreamChat).mockImplementation(async function* () {
    if (message.thinking) yield { kind: "delta" as const, delta: { thinking: message.thinking } }
    if (message.content) yield { kind: "delta" as const, delta: { content: message.content } }
    yield {
      kind: "done" as const,
      message: {
        role: "assistant" as const,
        content: message.content ?? null,
        thinking: message.thinking,
        tool_calls: message.tool_calls,
      },
    }
  })
}

describe("runAssistantAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings()
  })

  it("streams final text without tools", async () => {
    mockStreamMessage({ content: "Hello range" })
    const events = withoutStatus(
      await collect(
        runAssistantAgent({
          userMessages: [{ role: "user", content: "hi" }],
          toolCtx: { apiKey: "k", cookieHeader: "", luxOrigin: "http://127.0.0.1:3000" },
        }),
      ),
    )
    expect(events).toEqual([
      { type: "token", text: "Hello range" },
      { type: "done" },
    ])
    expect(executeAssistantTool).not.toHaveBeenCalled()
  })

  it("streams thinking deltas", async () => {
    mockStreamMessage({ thinking: "I will greet the user.", content: "Hello!" })
    const events = withoutStatus(
      await collect(
        runAssistantAgent({
          userMessages: [{ role: "user", content: "hi" }],
          toolCtx: { apiKey: "k", cookieHeader: "", luxOrigin: "http://127.0.0.1:3000" },
        }),
      ),
    )
    expect(events).toContainEqual({ type: "thinking", text: "I will greet the user." })
    expect(events).toContainEqual({ type: "token", text: "Hello!" })
  })

  it("runs tool then replies", async () => {
    vi.mocked(llmStreamChat)
      .mockImplementationOnce(async function* () {
        yield {
          kind: "done",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc1",
                type: "function",
                function: { name: "list_lux_operations", arguments: '{"query":"goad"}' },
              },
            ],
          },
        }
      })
      .mockImplementationOnce(async function* () {
        yield { kind: "delta", delta: { content: "Found GOAD ops" } }
        yield {
          kind: "done",
          message: { role: "assistant", content: "Found GOAD ops" },
        }
      })
    vi.mocked(executeAssistantTool).mockResolvedValue([{ operationId: "x" }])

    const events = withoutStatus(
      await collect(
        runAssistantAgent({
          userMessages: [{ role: "user", content: "list goad" }],
          toolCtx: { apiKey: "k", cookieHeader: "", luxOrigin: "http://127.0.0.1:3000" },
        }),
      ),
    )

    expect(events.some((e) => (e as { type: string }).type === "tool_start")).toBe(true)
    expect(events.some((e) => (e as { type: string }).type === "tool_result")).toBe(true)
    expect(events).toContainEqual({ type: "token", text: "Found GOAD ops" })
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("stops on needsConfirmation", async () => {
    mockStreamMessage({
      content: null,
      tool_calls: [
        {
          id: "tc1",
          type: "function",
          function: { name: "call_ludus_api", arguments: '{"operationId":"deployRange"}' },
        },
      ],
    })
    vi.mocked(executeAssistantTool).mockResolvedValue({
      needsConfirmation: true,
      confirmToken: "tok",
      summary: "POST /range/deploy",
    })

    const events = withoutStatus(
      await collect(
        runAssistantAgent({
          userMessages: [{ role: "user", content: "deploy" }],
          toolCtx: { apiKey: "k", cookieHeader: "", luxOrigin: "http://127.0.0.1:3000" },
        }),
      ),
    )

    expect(events).toContainEqual({
      type: "needs_confirmation",
      confirmToken: "tok",
      summary: "POST /range/deploy",
    })
    expect(llmStreamChat).toHaveBeenCalledTimes(1)
  })

  it("retries without tools after fetch failed", async () => {
    mockSettings({ llmBaseUrl: "http://ollama:11434/v1" })
    vi.mocked(llmStreamChat)
      .mockImplementationOnce(async function* () {
        yield { kind: "error", error: "fetch failed" }
      })
      .mockImplementationOnce(async function* () {
        yield { kind: "delta", delta: { content: "pong" } }
        yield { kind: "done", message: { role: "assistant", content: "pong" } }
      })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen2.5:14b" }] }), { status: 200 }),
    )

    const events = withoutStatus(
      await collect(
        runAssistantAgent({
          userMessages: [{ role: "user", content: "hi" }],
          toolCtx: { apiKey: "k", cookieHeader: "", luxOrigin: "http://127.0.0.1:3000" },
        }),
      ),
    )

    expect(events).toContainEqual({ type: "token", text: "pong" })
    expect(llmStreamChat).toHaveBeenCalledTimes(2)
    fetchSpy.mockRestore()
  })
})
