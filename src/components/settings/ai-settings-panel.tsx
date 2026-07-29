"use client"

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Loader2, Bot, RefreshCw, Download, CheckCircle2, XCircle, Info } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export interface AiSettingsDraft {
  aiAssistantEnabled?: boolean
  llmBaseUrl?: string
  llmApiKey?: string
  llmModel?: string
}

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Invalid JSON from server (HTTP ${res.status})`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function AiSettingsPanel<T extends AiSettingsDraft>({
  draft,
  setDraft,
  isAdmin,
  onSave,
  saving,
  isDirty,
}: {
  draft: T | null
  setDraft: Dispatch<SetStateAction<T | null>>
  isAdmin: boolean
  onSave: () => void
  saving: boolean
  isDirty: boolean
}) {
  const { toast } = useToast()
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmTestOk, setLlmTestOk] = useState<boolean | null>(null)
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([])
  const [modelsProvider, setModelsProvider] = useState<string>("")
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [pullName, setPullName] = useState("")
  const [pulling, setPulling] = useState(false)
  const [pullLog, setPullLog] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const looksOllama = /ollama|:11434/i.test(draft?.llmBaseUrl || "")
  const modelsReady = models.length > 0

  const loadModels = useCallback(
    async (opts?: { quiet?: boolean; preferModel?: string; attempts?: number; delayMs?: number }) => {
      const d = draftRef.current
      const baseUrl = d?.llmBaseUrl?.trim() || ""
      if (!isAdmin || !baseUrl) {
        setModels([])
        setModelsProvider("")
        setModelsError(null)
        return false
      }
      const attempts = Math.max(1, opts?.attempts ?? 1)
      const delayMs = opts?.delayMs ?? 750
      setModelsLoading(true)
      setModelsError(null)
      let lastErr = "Could not list models"
      try {
        for (let i = 0; i < attempts; i++) {
          if (i > 0) await sleep(delayMs)
          try {
            const qs = new URLSearchParams({ baseUrl })
            const headers: Record<string, string> = {}
            if (d?.llmApiKey?.trim()) headers["X-Llm-Api-Key"] = d.llmApiKey.trim()
            const res = await fetch(`/api/assistant/models?${qs}`, { headers })
            const data = await readJsonBody(res)
            if (!res.ok) throw new Error(String(data.error || `HTTP ${res.status}`))
            const list = (Array.isArray(data.models) ? data.models : []) as Array<{ id: string; name: string }>
            setModels(list)
            setModelsProvider(typeof data.provider === "string" ? data.provider : "")
            setLlmTestOk(true)
            setModelsError(null)
            const prefer = (opts?.preferModel || "").trim()
            if (prefer) {
              const hit =
                list.find((m) => m.id === prefer) ||
                list.find((m) => m.id === `${prefer}:latest` || m.id.startsWith(`${prefer}:`))
              if (!hit) {
                lastErr = `Model "${prefer}" not in list yet (${list.length} installed)`
                continue
              }
              setDraft((prev) => (prev ? { ...prev, llmModel: hit.id } : prev))
              return true
            }
            if (list.length > 0) {
              setDraft((prev) => {
                if (!prev) return prev
                const cur = (prev.llmModel || "").trim()
                if (cur && list.some((m) => m.id === cur)) return prev
                return { ...prev, llmModel: list[0].id }
              })
              return true
            }
            lastErr = "No models installed yet"
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err)
          }
        }
        setModels([])
        setModelsProvider("")
        setLlmTestOk(false)
        setModelsError(lastErr)
        if (!opts?.quiet) {
          toast({
            variant: "destructive",
            title: "Could not list models",
            description: lastErr,
          })
        }
        return false
      } finally {
        setModelsLoading(false)
      }
    },
    [isAdmin, setDraft, toast],
  )

  // Debounced auto-list when URL / key changes
  useEffect(() => {
    if (!isAdmin) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const base = draft?.llmBaseUrl?.trim() || ""
    if (!base) {
      setModels([])
      setModelsError(null)
      setLlmTestOk(null)
      return
    }
    debounceRef.current = setTimeout(() => {
      void loadModels({ quiet: true })
    }, 600)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isAdmin, draft?.llmBaseUrl, draft?.llmApiKey, loadModels])

  const testLlm = async () => {
    setLlmTesting(true)
    setLlmTestOk(null)
    try {
      const res = await fetch("/api/assistant/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmBaseUrl: draft?.llmBaseUrl,
          llmApiKey: draft?.llmApiKey,
          llmModel: draft?.llmModel,
        }),
      })
      const data = await readJsonBody(res)
      setLlmTestOk(!!data.ok)
      if (!data.ok) {
        toast({ variant: "destructive", title: "LLM test failed", description: String(data.error || "failed") })
      } else {
        toast({ title: "LLM reachable", description: `via ${String(data.via || "ok")}` })
        void loadModels({ quiet: false, attempts: 3 })
      }
    } catch (err) {
      setLlmTestOk(false)
      toast({ variant: "destructive", title: "LLM test failed", description: (err as Error).message })
    } finally {
      setLlmTesting(false)
    }
  }

  const pullModel = async () => {
    const name = pullName.trim()
    if (!name) return
    setPulling(true)
    setPullLog("")
    setModels([])
    setModelsError(null)
    try {
      const res = await fetch("/api/assistant/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          setAsDefault: true,
          llmBaseUrl: draft?.llmBaseUrl,
        }),
      })
      if (!res.ok || !res.body) {
        const data = await readJsonBody(res).catch(() => ({}))
        throw new Error(String((data as { error?: string }).error || `HTTP ${res.status}`))
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      let sawDone = false
      let pullOk = false
      const handleEvent = async (ev: {
        type?: string
        status?: string
        message?: string
        model?: string
        ok?: boolean
      }) => {
        if (ev.type === "error") {
          setPullLog(ev.message || "Pull failed")
          throw new Error(ev.message || "Pull failed")
        }
        if ((ev.type === "status" || ev.type === "progress") && ev.status) setPullLog(String(ev.status))
        if (ev.type === "done") {
          sawDone = true
          pullOk = ev.ok !== false && !!ev.model
          if (!pullOk) {
            throw new Error(ev.message || "Pull did not verify the model in Ollama")
          }
          const modelName = (ev.model || name).trim()
          const ok = await loadModels({ quiet: true, preferModel: modelName, attempts: 10, delayMs: 1500 })
          if (!ok) {
            toast({
              variant: "destructive",
              title: "Pull may still be finishing",
              description: `"${modelName}" not listed yet — wait, then Refresh models.`,
            })
            return
          }
          toast({ title: "Model ready", description: modelName })
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const chunks = buf.split("\n\n")
        buf = chunks.pop() || ""
        for (const chunk of chunks) {
          const line = chunk.trim()
          if (!line.startsWith("data:")) continue
          try {
            await handleEvent(JSON.parse(line.slice(5).trim()) as {
              type?: string
              status?: string
              message?: string
              model?: string
              ok?: boolean
            })
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
      // Flush trailing SSE frame (no trailing \n\n)
      if (buf.trim().startsWith("data:")) {
        try {
          await handleEvent(JSON.parse(buf.trim().slice(5).trim()) as {
            type?: string
            status?: string
            message?: string
            model?: string
            ok?: boolean
          })
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e
        }
      }
      if (!sawDone) {
        const ok = await loadModels({ quiet: true, preferModel: name, attempts: 8, delayMs: 1500 })
        if (ok) toast({ title: "Model ready", description: name })
        else if (!pullOk) {
          toast({
            variant: "destructive",
            title: "Pull incomplete",
            description: "Stream ended early — check Ollama logs and Refresh models.",
          })
        }
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Pull failed", description: (err as Error).message })
    } finally {
      setPulling(false)
    }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          <span className="font-medium text-foreground">Beta feature.</span> Expect bugs — verify tool
          results and deploys before trusting them. Report issues on{" "}
          <a
            href="https://github.com/ryokubaka/ludus-ux/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            GitHub Issues
          </a>
          . OpenAI-compatible LLM for the in-app Assistant. Optional Ollama on this LUX host:{" "}
          <code className="text-primary">docker compose --profile ollama up -d</code> (publishes{" "}
          <code className="text-primary">:11434</code>). From LUX use{" "}
          <code className="text-primary">http://ollama:11434/v1</code> (Compose DNS — not host.docker.internal).
          Default model <code className="text-primary">qwen2.5:14b</code> (~14B; needs ~10–12&nbsp;GB). Smaller
          models (e.g. llama3.2 3B) struggle with tools. Details:{" "}
          <code className="text-primary">docs/assistant.md</code>. Skill:{" "}
          <code className="text-primary">skills/ludus-ux</code>.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">AI Assistant</CardTitle>
            <Badge variant="warning" className="text-[10px] uppercase tracking-wide">
              Beta
            </Badge>
          </div>
          <CardDescription>
            Enable the sidebar Assistant (beta). Requires a reachable LLM endpoint and model. Save after
            configuring.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Enable assistant</p>
              <p className="text-xs text-muted-foreground">
                <code className="text-primary">ENABLE_AI_ASSISTANT</code>
              </p>
            </div>
            <Switch
              checked={draft?.aiAssistantEnabled ?? false}
              onCheckedChange={(v) => setDraft((d) => (d ? { ...d, aiAssistantEnabled: v } : d))}
              disabled={!isAdmin}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-base">
              LLM base URL
              <span className="ml-2 text-xs text-muted-foreground font-normal">LUX_LLM_BASE_URL</span>
            </Label>
            <Input
              id="llm-base"
              className="font-mono text-xs"
              placeholder="http://ollama:11434/v1 or https://api.openai.com/v1"
              value={draft?.llmBaseUrl || ""}
              onChange={(e) => setDraft((d) => (d ? { ...d, llmBaseUrl: e.target.value } : d))}
              disabled={!isAdmin}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-key">
              API key
              <span className="ml-2 text-xs text-muted-foreground font-normal">optional for Ollama</span>
            </Label>
            <Input
              id="llm-key"
              type="password"
              className="font-mono text-xs"
              value={draft?.llmApiKey || ""}
              onChange={(e) => setDraft((d) => (d ? { ...d, llmApiKey: e.target.value } : d))}
              disabled={!isAdmin}
              placeholder="sk-…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-model">Model</Label>
            {modelsReady ? (
              (() => {
                const cur = (draft?.llmModel || "").trim()
                const options =
                  cur && !models.some((m) => m.id === cur)
                    ? [{ id: cur, name: `${cur} (not listed by provider)` }, ...models]
                    : models
                const value = cur && options.some((m) => m.id === cur) ? cur : options[0]?.id || ""
                return (
                  <select
                    id="llm-model"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs font-mono"
                    value={value}
                    onChange={(e) => setDraft((d) => (d ? { ...d, llmModel: e.target.value } : d))}
                    disabled={!isAdmin}
                  >
                    {options.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )
              })()
            ) : (
              <Input
                id="llm-model"
                className="font-mono text-xs"
                value={(draft?.llmModel || "").trim()}
                onChange={(e) => setDraft((d) => (d ? { ...d, llmModel: e.target.value } : d))}
                disabled={!isAdmin}
                placeholder={
                  modelsLoading || pulling
                    ? "Waiting for models…"
                    : draft?.llmBaseUrl?.trim()
                      ? "No models yet — Test / Refresh / Pull"
                      : "Set LLM base URL first"
                }
              />
            )}
            {modelsReady &&
              (draft?.llmModel || "").trim() &&
              !models.some((m) => m.id === (draft?.llmModel || "").trim()) && (
                <p className="text-[10px] text-status-warning">
                  Saved model is not in the provider list — pick one above and Save, or the assistant
                  keeps using the saved id.
                </p>
              )}
            {modelsLoading && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking models…
              </p>
            )}
            {!modelsLoading && modelsReady && modelsProvider && (
              <p className="text-[10px] text-muted-foreground">
                Listed via {modelsProvider} ({models.length})
              </p>
            )}
            {!modelsLoading && !modelsReady && modelsError && (
              <p className="text-[10px] text-destructive">{modelsError}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={testLlm} disabled={!isAdmin || llmTesting || !draft?.llmBaseUrl?.trim()}>
              {llmTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Test connection
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadModels({ quiet: false, attempts: 3 })}
              disabled={!isAdmin || modelsLoading || pulling || !draft?.llmBaseUrl?.trim()}
            >
              {modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh models
            </Button>
            {llmTestOk === true && (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> OK
              </Badge>
            )}
            {llmTestOk === false && (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" /> Failed
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {looksOllama && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Install Ollama model</CardTitle>
            <CardDescription>
              Pull a new model into Ollama. Requires the Ollama service to be reachable from this container
              (Compose profile <code className="text-primary">ollama</code>).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                className="font-mono text-xs"
                placeholder="e.g. qwen2.5:14b"
                value={pullName}
                onChange={(e) => setPullName(e.target.value)}
                disabled={!isAdmin || pulling}
              />
              <Button size="sm" onClick={() => void pullModel()} disabled={!isAdmin || pulling || !pullName.trim()}>
                {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Pull
              </Button>
            </div>
            {pullLog && <p className={cn("text-xs font-mono text-muted-foreground")}>{pullLog}</p>}
          </CardContent>
        </Card>
      )}

      {isDirty && isAdmin && (
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save Changes
          </Button>
        </div>
      )}
    </div>
  )
}
