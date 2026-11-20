import { beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { NextRequest } from "next/server"
import { assertModelBaseUrl, anthropicMessagesUrl, fetchModelEndpoint, isCloudBlockedAddress, isLocalAddress, normalizeOpenAiBase, prepareModelUrl } from "@/lib/luxai/endpoint-policy"
import { historyCharBudget } from "@/lib/luxai/defaults"
import { buildCursorPrompt, completeCursor, cursorFailureDetail, cursorModelParams, cursorRequestModel, extractLuxaiTools, setCursorTurnRunnerForTests } from "@/lib/luxai/cursor"
import { buildAnthropicBody, buildOpenAiBody, completeProvider, interpretProbe, parseAnthropicBody, parseOpenAiBody, providerHeaders, scrubProviderError, thinkingBudget } from "@/lib/luxai/providers"
import { findLabPassword, redactSecrets, userNamedAccount } from "@/lib/luxai/redact"
import { LUXAI_SKILLS } from "@/lib/luxai/skills"
import { DEFAULT_LUXAI_PROMPT } from "@/lib/luxai/defaults"
import { bindLuxaiDbForTests, createSession, getChangeForUser, getLuxaiSettings, listSessions, saveLuxaiSettings } from "@/lib/luxai/store"
import { executeTool, resolveHostName, type LuxaiHost } from "@/lib/luxai/tools"
import { guestAnsibleStdin } from "@/lib/luxai/guest-stdin"

const lookup = async (host: string) => {
  if (host === "model.lab") return ["10.1.2.3"]
  if (host === "public.example") return ["203.0.113.10"]
  if (host === "mixed.example") return ["10.1.2.3", "203.0.113.10"]
  return []
}

describe("LUXAI endpoint policy", () => {
  it("allows a private local endpoint and refuses a public one", async () => {
    await expect(assertModelBaseUrl("http://10.1.2.3:11434/v1", "local", lookup)).resolves.toBeInstanceOf(URL)
    await expect(assertModelBaseUrl("http://model.lab/v1", "local", lookup)).resolves.toBeInstanceOf(URL)
    await expect(assertModelBaseUrl("http://169.254.169.254/v1", "local", lookup)).rejects.toThrow(/Local mode/)
    await expect(assertModelBaseUrl("https://api.anthropic.com/v1", "local", lookup)).rejects.toThrow(/public|Local mode|resolve/i)
    await expect(assertModelBaseUrl("http://public.example/v1", "local", lookup)).rejects.toThrow(/Local mode/)
    await expect(assertModelBaseUrl("http://mixed.example/v1", "local", lookup)).rejects.toThrow(/Local mode/)
  })

  it("requires https for cloud and blocks loopback and metadata", async () => {
    await expect(assertModelBaseUrl("http://203.0.113.10/v1", "cloud", async () => ["203.0.113.10"])).rejects.toThrow(/https/)
    await expect(assertModelBaseUrl("https://203.0.113.10/v1", "cloud", async () => ["203.0.113.10"])).resolves.toBeInstanceOf(URL)
    await expect(assertModelBaseUrl("https://127.0.0.1/v1", "cloud", lookup)).rejects.toThrow(/loopback|link-local|metadata/)
    await expect(assertModelBaseUrl("https://169.254.169.254/v1", "cloud", lookup)).rejects.toThrow(/loopback|link-local|metadata/)
    await expect(assertModelBaseUrl("https://user:pass@203.0.113.10/v1", "cloud", lookup)).rejects.toThrow(/username/)
    expect(isLocalAddress("127.0.0.1")).toBe(true)
    expect(isLocalAddress("8.8.8.8")).toBe(false)
    expect(isCloudBlockedAddress("::1")).toBe(true)
    await expect(assertModelBaseUrl("http://[::1]:11434/v1", "local", lookup)).resolves.toBeInstanceOf(URL)
    expect(isCloudBlockedAddress("::ffff:7f00:1")).toBe(true)
    expect(isLocalAddress("169.254.170.2")).toBe(false)
    const pinned = await prepareModelUrl("http://model.lab:11434/v1", "local", lookup)
    expect(pinned).toBe("http://10.1.2.3:11434/v1")
    expect(normalizeOpenAiBase("http://127.0.0.1:11434/v1/chat/completions")).toBe("http://127.0.0.1:11434/v1")
    expect(anthropicMessagesUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages")
    expect(anthropicMessagesUrl("https://opencode.ai/zen/v1/messages")).toBe("https://opencode.ai/zen/v1/messages")
  })

  it("follows a same-host http to https redirect and stops at a login page or another host", async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const target = String(input)
      calls.push(target)
      if (calls.length === 1) {
        return new Response(null, { status: 301, headers: { location: "https://model.lab/v1/models" } })
      }
      return new Response(JSON.stringify({ data: [{ id: "hermes-agent" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch
    const response = await fetchModelEndpoint(
      "http://model.lab/v1/models",
      { method: "GET" },
      "local",
      lookup,
      fetchImpl,
    )
    expect(response.status).toBe(200)
    expect(calls).toEqual(["http://model.lab/v1/models", "https://model.lab/v1/models"])

    const login = (async () => new Response(null, {
      status: 302,
      headers: { location: "/login?next=%2Fv1%2Fmodels" },
    })) as typeof fetch
    await expect(fetchModelEndpoint(
      "https://model.lab/v1/models",
      { method: "GET" },
      "local",
      lookup,
      login,
    )).rejects.toThrow(/login page/)

    const otherHost = (async () => new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/v1/models" },
    })) as typeof fetch
    await expect(fetchModelEndpoint(
      "https://model.lab/v1/models",
      { method: "GET" },
      "local",
      lookup,
      otherHost,
    )).rejects.toThrow(/different host/)

    const downgrade = (async () => new Response(null, {
      status: 302,
      headers: { location: "http://model.lab/v1/models" },
    })) as typeof fetch
    await expect(fetchModelEndpoint(
      "https://model.lab/v1/models",
      { method: "GET" },
      "local",
      lookup,
      downgrade,
    )).rejects.toThrow(/non-https/)
  })
})

describe("LUXAI providers", () => {
  const key = "sk-test-secret-value"

  it("builds an OpenAI tool request and parses a tool call without putting the key in the body", () => {
    const built = buildOpenAiBody({
      provider: "openai",
      baseUrl: "http://127.0.0.1:11434/v1/",
      apiKey: key,
      model: "local",
      messages: [{ role: "user", content: "list ranges" }],
      tools: [{ name: "list_ranges", description: "List", parameters: { type: "object", properties: {} } }],
      timeoutMs: 1000,
    })
    expect(built.url).toBe("http://127.0.0.1:11434/v1/chat/completions")
    expect(JSON.stringify(built.body)).not.toContain(key)
    expect(built.body).not.toHaveProperty("tool_choice")
    expect(built.body.temperature).toBe(0.2)
    const effort = buildOpenAiBody({
      provider: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: key,
      model: "local",
      messages: [{ role: "user", content: "list ranges" }],
      tools: [],
      timeoutMs: 1000,
      effort: "high",
    })
    expect(effort.body.reasoning_effort).toBe("high")
    expect(effort.body).not.toHaveProperty("temperature")
    expect(providerHeaders("openai", key).Authorization).toBe(`Bearer ${key}`)
    const parsed = parseOpenAiBody({
      choices: [{ message: { content: "<think>look up ranges</think>Here", reasoning_content: "extra", tool_calls: [{ id: "1", function: { name: "list_ranges", arguments: "{}" } }] } }],
    })
    expect(parsed.text).toBe("Here")
    expect(parsed.reasoning).toContain("look up ranges")
    expect(parsed.reasoning).toContain("extra")
    expect(parsed.toolCalls[0]).toEqual({ id: "1", name: "list_ranges", arguments: "{}" })
  })

  it("builds an Anthropic tool request and parses tool_use", () => {
    const built = buildAnthropicBody({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: key,
      model: "claude-test",
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "", toolCalls: [{ id: "toolu_1", name: "list_ranges", arguments: "{}" }] },
        { role: "tool", toolCallId: "toolu_1", name: "list_ranges", content: "[]" },
      ],
      tools: [{ name: "list_ranges", description: "List", parameters: { type: "object", properties: {} } }],
      timeoutMs: 1000,
    })
    expect(built.url).toBe("https://api.anthropic.com/v1/messages")
    expect(built.body.system).toBe("rules")
    expect(JSON.stringify(built.body)).not.toContain(key)
    const headers = providerHeaders("anthropic", key)
    expect(headers["x-api-key"]).toBe(key)
    expect(headers["anthropic-version"]).toBe("2026-10-21")
    expect(headers.Authorization).toBeUndefined()
    const tools = built.body.tools as Array<{ input_schema: unknown }>
    expect(tools[0].input_schema).toBeTruthy()
    expect(built.body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 })
    expect(thinkingBudget("high")).toBe(8192)
    const parsed = parseAnthropicBody({
      content: [
        { type: "text", text: "done" },
        { type: "tool_use", id: "toolu_1", name: "list_ranges", input: {} },
      ],
    })
    expect(parsed.text).toBe("done")
    expect(parsed.toolCalls[0].name).toBe("list_ranges")
  })

  it("treats 401 as a refused key and scrubs the key from errors", () => {
    expect(interpretProbe(401, {}).ok).toBe(false)
    expect(interpretProbe(200, { data: [{ id: "local" }] })).toEqual({
      ok: true,
      models: ["local"],
      catalog: [{ id: "local", displayName: "local", parameters: [] }],
    })
    expect(historyCharBudget(0)).toBe(320_000)
    expect(historyCharBudget(32_000)).toBe(96_000)
    expect(scrubProviderError(`bad ${key}`, key)).not.toContain(key)
  })

  it("emits each streamed token before the request finishes", async () => {
    const seen: string[] = []
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")
    const result = await completeProvider({
      provider: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: key,
      model: "local",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      timeoutMs: 1000,
      onPartial: (partial) => { if (partial.text) seen.push(partial.text) },
    }, async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }))
    expect(seen).toEqual(["Hel", "Hello"])
    expect(result.text).toBe("Hello")
  })

  it("keeps a Cursor key out of the prompt and reads a tool fence from the stream", async () => {
    const cursorKey = "crsr_test_key_value_123"
    const catalog = [{
      id: "composer-2",
      displayName: "Composer 2",
      parameters: [{ id: "fast", displayName: "Fast", values: [{ value: "true", displayName: "Fast" }, { value: "false", displayName: "Off" }] }],
    }]
    expect(cursorModelParams({
      model: "composer-2",
      effort: "high",
      contextWindow: 200_000,
      modelParams: [{ id: "fast", value: "true" }],
      catalog,
    })).toEqual([{ id: "fast", value: "true" }])
    expect(cursorRequestModel({
      model: "auto",
      effort: "high",
      contextWindow: 1_000_000,
      modelParams: [{ id: "fast", value: "true" }],
      catalog: [{ id: "auto", displayName: "Auto", parameters: [] }],
    })).toEqual({ id: "auto" })
    expect(cursorRequestModel({
      model: "auto-smart",
      effort: "high",
      contextWindow: 200_000,
      modelParams: [],
      catalog: [{
        id: "auto-smart",
        displayName: "Auto",
        parameters: [{
          id: "optimize_for",
          displayName: "Optimize for",
          values: [
            { value: "cost", displayName: "Cost" },
            { value: "balanced", displayName: "Balance" },
            { value: "intelligence", displayName: "Intelligence" },
          ],
        }],
      }],
    })).toEqual({ id: "auto-smart", params: [{ id: "optimize_for", value: "cost" }] })
    expect(cursorRequestModel({
      model: "auto-smart",
      effort: "",
      contextWindow: 0,
      modelParams: [{ id: "optimize_for", value: "intelligence" }],
      catalog: [{
        id: "auto-smart",
        displayName: "Auto",
        parameters: [{
          id: "optimize_for",
          displayName: "Optimize for",
          values: [
            { value: "cost", displayName: "Cost" },
            { value: "intelligence", displayName: "Intelligence" },
          ],
        }],
      }],
    })).toEqual({ id: "auto-smart", params: [{ id: "optimize_for", value: "intelligence" }] })
    expect(cursorRequestModel({
      model: "grok-4.7",
      effort: "high",
      contextWindow: 1_000_000,
      modelParams: [],
      catalog: [{
        id: "grok-4.7",
        displayName: "Grok 4.7",
        parameters: [],
        variants: [
          { displayName: "Grok 4.7", params: [{ id: "fast", value: "false" }], isDefault: true },
          { displayName: "Grok 4.7 Fast", params: [{ id: "fast", value: "true" }] },
        ],
      }],
    })).toEqual({ id: "grok-4.7", params: [{ id: "fast", value: "false" }] })
    const prompt = buildCursorPrompt({
      provider: "cursor",
      baseUrl: "https://api.cursor.com",
      apiKey: cursorKey,
      model: "composer-2",
      messages: [{ role: "user", content: "list ranges" }],
      tools: [{ name: "list_ranges", description: "List", parameters: {} }],
      timeoutMs: 1000,
    })
    expect(prompt).not.toContain(cursorKey)
    expect(extractLuxaiTools("Answer\n```luxai-tools\n[{\"name\":\"list_ranges\",\"arguments\":{}}]\n```")).toEqual({
      text: "Answer",
      toolCalls: [{ id: "cursor_1", name: "list_ranges", arguments: "{}" }],
    })
    let seenModel: { id?: string; params?: unknown } | undefined
    setCursorTurnRunnerForTests(async (request) => {
      expect(request.prompt).not.toContain(cursorKey)
      expect(request.apiKey).toBe(cursorKey)
      seenModel = request.model
      request.onPartial?.({ reasoning: "Look", text: "Done\n```luxai-tools\n[{\"name\":\"list_ranges\",\"arguments\":{}}]\n```" })
      return { text: "Done\n```luxai-tools\n[{\"name\":\"list_ranges\",\"arguments\":{}}]\n```", reasoning: "Look" }
    })
    const result = await completeCursor({
      provider: "cursor",
      baseUrl: "https://api.cursor.com",
      apiKey: cursorKey,
      model: "composer-2",
      effort: "high",
      modelParams: [{ id: "fast", value: "true" }],
      catalog,
      messages: [{ role: "user", content: "list ranges" }],
      tools: [{ name: "list_ranges", description: "List", parameters: {} }],
      timeoutMs: 1000,
      onPartial: () => undefined,
    })
    setCursorTurnRunnerForTests(null)
    expect(seenModel).toEqual({ id: "composer-2", params: [{ id: "fast", value: "true" }] })
    expect(result.text).toBe("Done")
    expect(result.reasoning).toBe("Look")
    expect(result.toolCalls[0]?.name).toBe("list_ranges")
  })

  it("asks the local Cursor agent for Auto on Cost and does not start a cloud agent", async () => {
    let seenModel: { id?: string; params?: unknown } | undefined
    setCursorTurnRunnerForTests(async (request) => {
      seenModel = request.model
      return { text: "Ready.", reasoning: "" }
    })
    const result = await completeCursor({
      provider: "cursor",
      baseUrl: "https://api.cursor.com",
      apiKey: "crsr_test_key_value_123",
      model: "auto-smart",
      effort: "high",
      contextWindow: 200_000,
      modelParams: [{ id: "fast", value: "true" }],
      catalog: [{
        id: "auto-smart",
        displayName: "Auto",
        parameters: [{
          id: "optimize_for",
          displayName: "Optimize for",
          values: [
            { value: "cost", displayName: "Cost" },
            { value: "balanced", displayName: "Balance" },
          ],
        }],
      }],
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      timeoutMs: 1000,
    })
    setCursorTurnRunnerForTests(null)
    expect(seenModel).toEqual({ id: "auto-smart", params: [{ id: "optimize_for", value: "cost" }] })
    expect(result.text).toBe("Ready.")
  })

  it("names a Cursor run failure that left the result empty", () => {
    expect(cursorFailureDetail(
      { error: { message: "Custom system prompt is not enabled for this account.", code: "InvalidArgument" } },
      [],
    )).toContain("Custom system prompt")
  })
})

describe("LUXAI tools and journal", () => {
  const db = new Database(":memory:")

  beforeEach(() => {
    db.exec("DROP TABLE IF EXISTS luxai_settings")
    db.exec("DROP TABLE IF EXISTS luxai_sessions")
    db.exec("DROP TABLE IF EXISTS luxai_messages")
    db.exec("DROP TABLE IF EXISTS luxai_changes")
    db.exec("DROP TABLE IF EXISTS luxai_runs")
    bindLuxaiDbForTests(db)
  })

  it("stores the key encrypted and clears it when the endpoint changes", () => {
    const previous = process.env.APP_SECRET
    process.env.APP_SECRET = "unit-test-secret-value-32-chars!!"
    const saved = saveLuxaiSettings(getLuxaiSettings(), {
      enabled: true,
      provider: "openai",
      egress: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local",
      apiKey: "local-key-12345678",
    })
    expect(saved.apiKey).toBe("local-key-12345678")
    const raw = db.prepare("SELECT value FROM luxai_settings WHERE key = 'apiKey'").get() as { value: string }
    expect(raw.value.startsWith("enc:v2:")).toBe(true)
    expect(raw.value).not.toContain("local-key")
    const cleared = saveLuxaiSettings(getLuxaiSettings(), { baseUrl: "http://10.1.1.1:11434/v1" })
    expect(cleared.apiKey).toBe("")
    if (previous === undefined) delete process.env.APP_SECRET
    else process.env.APP_SECRET = previous
  })

  it("stores a Cursor key against the Cursor API and keeps effort and context", () => {
    const previous = process.env.APP_SECRET
    process.env.APP_SECRET = "unit-test-secret-value-32-chars!!"
    const saved = saveLuxaiSettings(getLuxaiSettings(), {
      enabled: true,
      provider: "cursor",
      egress: "local",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "composer-2",
      apiKey: "crsr_example_key_123456",
      effort: "high",
      contextWindow: 200_000,
      modelCatalog: [{ id: "composer-2", displayName: "Composer 2", parameters: [] }],
    })
    expect(saved.provider).toBe("cursor")
    expect(saved.egress).toBe("cloud")
    expect(saved.baseUrl).toBe("https://api.cursor.com")
    expect(saved.effort).toBe("high")
    expect(saved.contextWindow).toBe(200_000)
    expect(saved.modelCatalog[0]?.id).toBe("composer-2")
    expect(getLuxaiSettings().apiKey).toBe("crsr_example_key_123456")
    if (previous === undefined) delete process.env.APP_SECRET
    else process.env.APP_SECRET = previous
  })

  it("keeps each provider key when the active provider changes", () => {
    const previous = process.env.APP_SECRET
    process.env.APP_SECRET = "unit-test-secret-value-32-chars!!"
    saveLuxaiSettings(getLuxaiSettings(), {
      provider: "openai",
      egress: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local",
      apiKey: "openai-key-aaaa",
    })
    saveLuxaiSettings(getLuxaiSettings(), {
      provider: "anthropic",
      egress: "cloud",
      baseUrl: "https://api.anthropic.com",
      model: "claude",
      apiKey: "anthropic-key-bbbb",
    })
    saveLuxaiSettings(getLuxaiSettings(), {
      provider: "cursor",
      model: "composer-2",
      apiKey: "cursor-key-cccc",
    })
    const backToOpenAI = saveLuxaiSettings(getLuxaiSettings(), {
      provider: "openai",
      egress: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local",
    })
    expect(backToOpenAI.apiKey).toBe("openai-key-aaaa")
    expect(backToOpenAI.model).toBe("local")
    const backToAnthropic = saveLuxaiSettings(getLuxaiSettings(), { provider: "anthropic" })
    expect(backToAnthropic.apiKey).toBe("anthropic-key-bbbb")
    expect(backToAnthropic.baseUrl).toBe("https://api.anthropic.com")
    const backToCursor = saveLuxaiSettings(getLuxaiSettings(), { provider: "cursor" })
    expect(backToCursor.apiKey).toBe("cursor-key-cccc")
    expect(backToCursor.baseUrl).toBe("https://api.cursor.com")
    expect(backToCursor.egress).toBe("cloud")
    const clearedOpenAI = saveLuxaiSettings(getLuxaiSettings(), {
      provider: "openai",
      baseUrl: "http://10.1.1.1:11434/v1",
    })
    expect(clearedOpenAI.apiKey).toBe("")
    expect(saveLuxaiSettings(getLuxaiSettings(), { provider: "anthropic" }).apiKey).toBe("anthropic-key-bbbb")
    const openAiKey = db.prepare("SELECT value FROM luxai_settings WHERE key = 'apiKey.openai'").get() as { value: string }
    expect(openAiKey.value).toBe("")
    const anthropicKey = db.prepare("SELECT value FROM luxai_settings WHERE key = 'apiKey.anthropic'").get() as { value: string }
    expect(anthropicKey.value.startsWith("enc:v2:")).toBe(true)
    expect(anthropicKey.value).not.toContain("anthropic-key")
    if (previous === undefined) delete process.env.APP_SECRET
    else process.env.APP_SECRET = previous
  })

  it("matches DC01 to the full GOAD VM name", async () => {
    expect(resolveHostName(
      ["smeowden-GOAD-Mini-49UF6C-GOAD-DC01", "smeowden-GOAD-Mini-49UF6C-elk"],
      "DC01",
    )).toBe("smeowden-GOAD-Mini-49UF6C-GOAD-DC01")
    const host: LuxaiHost = {
      listRanges: async () => [{ rangeID: "smeowden-GOAD-Mini-49UF6C", rangeNumber: 2, name: "GOAD Mini" }],
      readRange: async () => ({
        rangeID: "smeowden-GOAD-Mini-49UF6C",
        VMs: [
          { name: "smeowden-GOAD-Mini-49UF6C-GOAD-DC01", ip: "10.2.10.10", poweredOn: true },
          { name: "smeowden-GOAD-Mini-49UF6C-elk", ip: "10.2.10.50", poweredOn: true },
        ],
      }),
      readConfig: async () => "",
      writeConfig: async () => undefined,
      power: async () => undefined,
      deploy: async () => undefined,
      readInventory: async () => "",
      runGuest: async () => "",
      describeGoad: async () => "",
      listGoadCatalog: async () => "",
      createRange: async () => undefined,
      deleteRange: async () => undefined,
      startGoadDeploy: async () => "task",
      fetchDoc: async () => "",
    }
    const session = createSession("alice", "dc")
    const outcome = await executeTool("propose_guest_command", {
      rangeID: "smeowden-GOAD-Mini-49UF6C",
      host: "DC01",
      shell: "powershell",
      command: "Get-Process",
      summary: "processes on DC01",
    }, { username: "alice", apiKey: "k", sessionId: session.id, userText: "List processes on DC01", host })
    expect(outcome.ok).toBe(true)
    expect(outcome.change?.preview).toContain("smeowden-GOAD-Mini-49UF6C-GOAD-DC01")
    expect(outcome.text).toContain("matched from DC01")
  })

  it("proposes a range config without uploading it, and hides another user's session", async () => {
    const writes: string[] = []
    const host: LuxaiHost = {
      listRanges: async () => [{ rangeID: "lab", rangeNumber: 2, accessType: "Direct" }],
      readRange: async () => ({ rangeID: "lab", rangeState: "SUCCESS", VMs: [{ name: "DC01", ip: "10.2.10.10", poweredOn: true }] }),
      readConfig: async () => "ludus:\n  - vm_name: a\n    hostname: a\n    template: t\n    vlan: 10\n    ip_last_octet: 10\n    ram_gb: 2\n    cpus: 1\n",
      writeConfig: async (_key, _id, yamlText) => { writes.push(yamlText) },
      power: async () => undefined,
      deploy: async () => undefined,
      readInventory: async () => "DC01 ansible_user=localadmin ansible_password=SecretPass ansible_host=10.2.10.10\n",
      runGuest: async () => "should-not-run",
      describeGoad: async () => "linked",
      listGoadCatalog: async () => "Labs: none",
      createRange: async () => undefined,
      deleteRange: async () => undefined,
      startGoadDeploy: async () => "task",
      fetchDoc: async () => "docs",
    }
    const session = createSession("alice", "hello")
    const outcome = await executeTool("propose_range_config", {
      rangeId: "lab",
      summary: "add a note",
      yaml: "ludus:\n  - vm_name: a\n    hostname: a\n    template: t\n    vlan: 10\n    ip_last_octet: 11\n    ram_gb: 2\n    cpus: 1\n",
    }, { username: "alice", apiKey: "k", sessionId: session.id, userText: "edit lab", host })
    expect(outcome.ok).toBe(true)
    expect(outcome.change?.status).toBe("pending")
    expect(outcome.change?.yaml).toContain("ip_last_octet: 11")
    expect(writes).toEqual([])
    expect(getChangeForUser("bob", outcome.change!.id)).toBeNull()

    const created = await executeTool("propose_create_range", {
      rangeId: "ludusai-test",
      name: "ludusai-test",
      summary: "Create ludusai-test",
      yaml: "ludus:\n  - vm_name: \"{{ range_id }}-dc01\"\n    hostname: \"{{ range_id }}-dc01\"\n    template: win2022-server-x64-template\n    vlan: 10\n    ip_last_octet: 10\n    ram_gb: 8\n    cpus: 4\n",
    }, { username: "alice", apiKey: "k", sessionId: session.id, userText: "build ludusai-test", host })
    expect(created.ok).toBe(true)
    expect(created.change?.yaml).toContain("win2022-server-x64-template")
    expect(created.change?.yaml).toContain("sysprep: false")
    expect(created.change?.kind).toBe("range_create")
    const deployed = await executeTool("propose_create_range", {
      rangeId: "ludusai-test",
      name: "ludusai-test",
      summary: "Create and deploy ludusai-test",
      deploy: true,
      yaml: "ludus:\n  - vm_name: \"{{ range_id }}-dc01\"\n    hostname: \"{{ range_id }}-dc01\"\n    template: win2022-server-x64-template\n    vlan: 10\n    ip_last_octet: 10\n    ram_gb: 8\n    cpus: 4\n",
    }, { username: "alice", apiKey: "k", sessionId: session.id, userText: "build and deploy ludusai-test", host })
    expect(getChangeForUser("alice", deployed.change!.id)?.afterText).toContain("\"deploy\":true")
    expect(listSessions("bob")).toEqual([])

    const inventory = await executeTool("get_inventory", { rangeId: "lab" }, {
      username: "alice", apiKey: "k", sessionId: session.id, userText: "show inventory", host,
    })
    expect(inventory.text).toContain("[redacted]")
    expect(inventory.text).not.toContain("SecretPass")

    const hidden = await executeTool("reveal_lab_password", { rangeId: "lab", account: "localadmin" }, {
      username: "alice", apiKey: "k", sessionId: session.id, userText: "what is the state", host,
    })
    expect(hidden.ok).toBe(false)
    const shown = await executeTool("reveal_lab_password", { rangeId: "lab", account: "localadmin" }, {
      username: "alice", apiKey: "k", sessionId: session.id, userText: "what is the password for localadmin", host,
    })
    expect(shown.text).toContain("SecretPass")
  })

  it("redacts inventory fields and requires the operator to name the account", () => {
    const text = "srv ansible_user=labuser ansible_password=SecretPass"
    expect(redactSecrets(text)).not.toContain("SecretPass")
    expect(findLabPassword(text, "labuser")?.password).toBe("SecretPass")
    const groups = "[windows:vars]\nansible_user=win\nansible_password=WindowsSecret\n[linux:vars]\nansible_user=ubuntu\nansible_password=LinuxSecret\n"
    expect(findLabPassword(groups, "ubuntu")?.password).toBe("LinuxSecret")
    expect(findLabPassword(groups, "ubuntu")?.password).not.toBe("WindowsSecret")
    expect(userNamedAccount("reset the labuser account", "labuser")).toBe(true)
    expect(userNamedAccount("reset the labuser account", "lab")).toBe(false)
  })

  it("keeps exploit tool names out of the bundled skills and the default prompt", () => {
    const blob = `${DEFAULT_LUXAI_PROMPT}\n${Object.values(LUXAI_SKILLS).map((skill) => skill.body).join("\n")}`
    for (const word of ["certipy", "ntlmrelay", "rubeus", "mimikatz", "secretsdump", "petitpotam"]) {
      expect(blob.toLowerCase()).not.toContain(word)
    }
  })

  it("refuses a guest stdin key that is not a single token", () => {
    expect(guestAnsibleStdin("luxuser.key12345", "Get-Date")).toBe("luxuser.key12345\nGet-Date")
    expect(() => guestAnsibleStdin("bad key", "id")).toThrow(/API key/)
  })
})

vi.mock("@/lib/session/require-session", () => ({
  requireSession: vi.fn(async () => ({ ok: false, response: Response.json({ error: "Not authenticated" }, { status: 401 }) })),
}))

vi.mock("@/lib/luxai/actions", () => ({
  createLiveHost: vi.fn(),
  luxaiActor: vi.fn(),
  applyStoredChange: vi.fn(),
  revertStoredChange: vi.fn(),
}))

vi.mock("@/lib/luxai/agent", () => ({
  runLuxaiAgent: vi.fn(),
}))

describe("LUXAI routes", () => {
  it("refuses an anonymous chat and settings read", async () => {
    const { POST } = await import("@/app/api/luxai/chat/route")
    const { GET } = await import("@/app/api/luxai/settings/route")
    const chat = await POST(new NextRequest("http://localhost/api/luxai/chat", { method: "POST", body: "{}" }))
    const settings = await GET(new NextRequest("http://localhost/api/luxai/settings"))
    expect(chat.status).toBe(401)
    expect(settings.status).toBe(401)
  })
})
