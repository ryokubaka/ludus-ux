import { describe, expect, it } from "vitest"
import {
  normalizeLlmBaseUrl,
  ollamaOriginFromBaseUrl,
  looksLikeOllamaBaseUrl,
  defaultLlmStreamTimeoutMs,
  normalizeOpenAiModelsPayload,
  normalizeOllamaTagsPayload,
} from "./llm-client"

describe("normalizeLlmBaseUrl", () => {
  it("trims and strips trailing slashes", () => {
    expect(normalizeLlmBaseUrl("  http://ollama:11434/v1/  ")).toBe("http://ollama:11434/v1")
  })
})

describe("ollamaOriginFromBaseUrl", () => {
  it("strips /v1", () => {
    expect(ollamaOriginFromBaseUrl("http://ollama:11434/v1")).toBe("http://ollama:11434")
  })

  it("treats hostname ollama as Ollama even without /v1", () => {
    expect(ollamaOriginFromBaseUrl("http://ollama:11434")).toBe("http://ollama:11434")
  })

  it("returns null for generic OpenAI URLs", () => {
    expect(ollamaOriginFromBaseUrl("https://api.openai.com/v1")).toBeNull()
  })
})

describe("looksLikeOllamaBaseUrl", () => {
  it("is true for ollama URLs", () => {
    expect(looksLikeOllamaBaseUrl("http://127.0.0.1:11434/v1")).toBe(true)
  })
})

describe("defaultLlmStreamTimeoutMs", () => {
  it("gives Ollama a long idle window", () => {
    expect(defaultLlmStreamTimeoutMs("http://ollama:11434/v1")).toBe(900_000)
  })

  it("keeps cloud endpoints at 3m", () => {
    expect(defaultLlmStreamTimeoutMs("https://api.openai.com/v1")).toBe(180_000)
  })
})

describe("normalizeOpenAiModelsPayload", () => {
  it("maps data[].id", () => {
    expect(normalizeOpenAiModelsPayload({ data: [{ id: "gpt-4o-mini" }, { id: "a" }] })).toEqual([
      { id: "a", name: "a" },
      { id: "gpt-4o-mini", name: "gpt-4o-mini" },
    ])
  })

  it("handles empty", () => {
    expect(normalizeOpenAiModelsPayload(null)).toEqual([])
  })
})

describe("normalizeOllamaTagsPayload", () => {
  it("maps models[].name", () => {
    expect(normalizeOllamaTagsPayload({ models: [{ name: "qwen2.5:14b" }] })).toEqual([
      { id: "qwen2.5:14b", name: "qwen2.5:14b" },
    ])
  })
})
