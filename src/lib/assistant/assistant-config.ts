import { createHmac, timingSafeEqual } from "crypto"
import { getSettings } from "@/lib/settings-store"

export function isAssistantConfigured(): { ok: true } | { ok: false; reason: string } {
  const s = getSettings()
  if (!s.aiAssistantEnabled) return { ok: false, reason: "AI assistant is disabled (Settings → AI)." }
  if (!s.llmBaseUrl.trim()) return { ok: false, reason: "LLM base URL is not set (Settings → AI)." }
  if (!s.llmModel.trim()) return { ok: false, reason: "LLM model is not set (Settings → AI)." }
  return { ok: true }
}

function confirmSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

export interface PendingDestructiveCall {
  surface: "ludus" | "lux"
  operationId: string
  method: string
  path: string
  args?: Record<string, unknown>
  exp: number
}

export function signConfirmToken(payload: Omit<PendingDestructiveCall, "exp">, ttlMs = 5 * 60_000): string {
  const body: PendingDestructiveCall = { ...payload, exp: Date.now() + ttlMs }
  const data = Buffer.from(JSON.stringify(body), "utf8").toString("base64url")
  const sig = createHmac("sha256", confirmSecret()).update(data).digest("base64url")
  return `${data}.${sig}`
}

export function verifyConfirmToken(token: string): PendingDestructiveCall | null {
  const [data, sig] = token.split(".")
  if (!data || !sig) return null
  const expect = createHmac("sha256", confirmSecret()).update(data).digest("base64url")
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expect)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as PendingDestructiveCall
    if (!parsed || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null
    if (parsed.surface !== "ludus" && parsed.surface !== "lux") return null
    return parsed
  } catch {
    return null
  }
}

export interface PendingAskCall {
  kind: "ask"
  prompt: import("@/lib/assistant/ask-user").AskPrompt
  exp: number
}

export function signAskToken(
  prompt: import("@/lib/assistant/ask-user").AskPrompt,
  ttlMs = 30 * 60_000,
): string {
  const body: PendingAskCall = { kind: "ask", prompt, exp: Date.now() + ttlMs }
  const data = Buffer.from(JSON.stringify(body), "utf8").toString("base64url")
  const sig = createHmac("sha256", confirmSecret()).update(data).digest("base64url")
  return `${data}.${sig}`
}

export function verifyAskToken(token: string): PendingAskCall | null {
  const [data, sig] = token.split(".")
  if (!data || !sig) return null
  const expect = createHmac("sha256", confirmSecret()).update(data).digest("base64url")
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expect)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as PendingAskCall
    if (!parsed || parsed.kind !== "ask") return null
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null
    if (!parsed.prompt?.title || !Array.isArray(parsed.prompt.questions)) return null
    return parsed
  } catch {
    return null
  }
}
