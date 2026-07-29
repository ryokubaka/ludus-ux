# In-app AI assistant

> **Beta.** The in-app AI Assistant is an early feature. Expect rough edges (wrong tool args, incomplete wizards, over-confident replies). **Verify** range config, GOAD deploys, and destructive actions before trusting them. **Report bugs** (steps, model, and a copied session if possible) on [GitHub Issues](https://github.com/ryokubaka/ludus-ux/issues).

Ludus UX ships an optional **Assistant** chat that calls an **OpenAI-compatible** LLM and runs **session-scoped tools** against Ludus `/api/v2` and LUX `/api/*`. It does **not** spawn `@badsectorlabs/ludus-mcp` inside the container.

Skill context comes from [`skills/ludus-ux`](../skills/ludus-ux/) (**preferred** for LUX flows). Full [ludus-skills](https://gitlab.com/badsectorlabs/ludus-skills) are vendored under [`skills/ludus/`](../skills/ludus/) as a **supplement** (range schema, CLI, troubleshooting, environment recipes) and are searchable via the documentation tools.

## Enable

1. **Settings → AI** (`/settings?tab=ai`) — admin write only.
2. Turn **Enable assistant** on.
3. Set **LLM base URL** and **model** (API key optional for Ollama).
4. **Test connection**, then **Save**.

Sidebar **Assistant** appears when enabled **and** `llmBaseUrl` is non-empty.

| Setting | Env | Notes |
|---------|-----|--------|
| Enable | `ENABLE_AI_ASSISTANT` | Default `false` |
| Base URL | `LUX_LLM_BASE_URL` | e.g. `http://ollama:11434/v1` (Compose service DNS) |
| API key | `LUX_LLM_API_KEY` | Encrypted in SQLite; optional for Ollama |
| Model | `LUX_LLM_MODEL` | Default `qwen2.5:14b` |

Env seeds defaults; UI overrides persist in SQLite (same pattern as other Settings).

## Model recommendations

Ludus’s published [AI Assistants](https://docs.ludus.cloud/docs/using-ludus/mcp) flow targets IDE agents (Claude Code, Cursor, Codex, etc.) plus MCP + skills — **not** a specific Ollama tag. Capability depends heavily on the model you attach.

| Tier | Examples | Expectation |
|------|----------|-------------|
| Too small for tools | `llama3.2` (~3B) | Greetings / short Q&A only; invents APIs, drifts topics |
| **Default / minimum local** | **`qwen2.5:14b`** | Intended floor for multi-step tools + docs search; still needs validation |
| Stronger local | `qwen2.5:32b`, other ≥14B instruct w/ tool calling | Better lab recipes / deploy flows if you have RAM/VRAM |
| Cloud mid / frontier | OpenAI-compatible mid-tier → Sonnet / GPT-4o class | Closest to Ludus’s IDE demos (“build me an Elastic server”) |

**Important:** Defaulting to `qwen2.5:14b` is a **starting point**, not a guarantee. Multi-step range builds (Elastic, GOAD, complex YAML) are **not thoroughly validated** yet across models. The assistant is **beta**: verify tool calls, range config, and deploys before trusting production ranges. Prefer a stronger model if demos fail. File issues at [github.com/ryokubaka/ludus-ux/issues](https://github.com/ryokubaka/ludus-ux/issues).

Rough local sizing: `qwen2.5:14b` Q4 ≈ 10–12 GB RAM/VRAM; first Ollama pull is large and slow.

## GPU (NVIDIA)

Compose Ollama is CPU-only until the **NVIDIA Container Toolkit** is installed on the LUX host and the `ollama` service has `gpus: all` (shipped in `docker-compose.yml`).

**This host already has an RTX 3090 + driver** — install the toolkit, then recreate Ollama:

```bash
# Ubuntu/Debian — https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

cd /path/to/ludus-ux
docker compose --profile ollama up -d --force-recreate ollama
```

Verify GPU inside the container:

```bash
docker exec ludus-ux-ollama nvidia-smi
docker logs ludus-ux-ollama 2>&1 | grep -i 'inference compute'
# Expect library=cuda (or similar), not library=cpu
```

Optional: pin a device with `LUX_OLLAMA_NVIDIA_VISIBLE_DEVICES=0` in `.env`. CPU-only: remove `gpus: all` from the `ollama` service and recreate.

AMD/ROCm and Apple Metal are not covered by this Compose profile (run Ollama on the host and point `LUX_LLM_BASE_URL` at it instead).

## Ollama (Compose profile)

```bash
docker compose --profile ollama up -d
```

- Service `ollama` listens on **`0.0.0.0:11434`**, publishes **`LUX_OLLAMA_HOST_PORT` / `11434`** on the **LUX host**, and pulls `LUX_LLM_MODEL` / `qwen2.5:14b` on first start.
- Point LUX at **`http://ollama:11434/v1`** (Compose DNS; avoid `host.docker.internal:11434` on Linux). Host/LAN: `http://127.0.0.1:11434`. Smoke: `scripts/smoke-assistant-llm.sh`.
- AI tab: list / pull models. First pull of `qwen2.5:14b` can take a while (`docker logs ludus-ux-ollama`). Entrypoint also pulls the default model in the background on start (resumable).
- Chat `fetch failed`: usually Ollama down/restarting, oversized prompt, or pressure — LUX uses a smaller skill context, `num_ctx` cap, and retries without tools.
- **CPU / large models:** First reply can take several minutes (prompt eval). LUX waits up to **15 minutes** of idle stream time for Ollama; a hard abort is shown as a timeout error, not Cancelled. Stop still cancels.

Default stack without the profile is unchanged.

## Tools & safety

Tools: `list_*` / `describe_*` / `call_*` for **Ludus** and **LUX**, plus documentation search/fetch. Calls use the logged-in session (impersonation uses that user’s key). Keys never go to the browser for tool auth.

Destructive ops return `needsConfirmation` + HMAC `confirmToken`. The chat UI offers **Allow once**, **Always allow this** (operation allowlist for the conversation), **Allow all this chat**, or **Deny**. The confirm card shows method/path plus a preview of body/query/path params (e.g. which templates will Packer-build). Approval re-executes the pending call server-side (avoids the model re-prompt loop), then continues the run.

**Interactive prompts:** the model can call `ask_user` for non-open-ended clarifying questions (button choices, multi-select, optional text). **Before** inventing options, it must `search_documentation` / `read_documentation` using `skills/ludus-ux/references/workflows/INDEX.md` (topic → playbook). Copy option ids from the playbook — never invent flags like `--dedicated`. Answers continue the run via `POST /api/assistant/answer`.

Tool call rows keep a longer redacted transcript (expandable); secrets such as API keys and confirm tokens are stripped from the chat display and from tool payloads returned into the LLM loop.

After long-running kickoffs (e.g. Packer `buildTemplates`, range deploy), the assistant should **not** POST again — it tells you to open the right page (`/templates`, `/range`, …) and may peek at read-only logs.

**GOAD:** Assistant uses `ask_user` for path (`lux_goad` vs Ludus `goad` blueprint), then an in-chat wizard (extensions → range → network → confirm) and `call_lux_api` (`getGoadCatalog` / `createRange` / `executeGoad` with string `body.args`). Match lab **by name** (never first catalog row — often ADFS). UI `/goad` remains available if the user asks for it.

System prompt (`src/lib/assistant/system-prompt.ts`) is user-facing and placed **before** skill reference text so smaller models follow voice/answer rules. Heavy Ludus troubleshooting (incl. WireGuard) is **not** dumped into every prompt — use docs tools instead.

### Documentation corpus

The assistant cannot fit all of [docs.ludus.cloud](https://docs.ludus.cloud/) in context. Instead:

- Indexes LUX `docs/*.md`, all of `skills/**` (`ludus-ux` preferred, `ludus` supplement), and `DATA_DIR/docs-cache/ludus/`
- Tools: `search_documentation`, `read_documentation`, `fetch_ludus_doc` (allowed host: `docs.ludus.cloud`)
- First chat auto-seeds a curated core set; admin can refresh via `POST /api/assistant/docs/seed`

## Conversation history & background runs

Chat rows live in SQLite (`assistant_conversations`) per Ludus username (impersonation target when active).

**Background runs:** `POST /api/assistant/chat` starts an in-process job that keeps going if you refresh or navigate away. The UI polls conversation state to catch up. **Stop** cancels the active run; sending a new message **overrides** (cancels then starts). Process restart mid-run → `interrupted` (history kept).

## APIs

| Method | Path | Notes |
|--------|------|--------|
| `GET` / `POST` | `/api/assistant/docs/seed` | Admin; corpus stats / seed Ludus docs cache |
| `POST` | `/api/assistant/chat` | Start background run (`conversationId` + `userText`); returns `{ runId }` |
| `GET` | `/api/assistant/runs/[runId]/stream` | Optional SSE replay/live for a run |
| `POST` | `/api/assistant/conversations/[id]/cancel` | Stop active run |
| `GET` / `POST` | `/api/assistant/conversations` | List / create sessions |
| `GET` / `PUT` / `DELETE` | `/api/assistant/conversations/[id]` | Load / save / delete |
| `GET` | `/api/assistant/models` | Admin; OpenAI `/models` and/or Ollama tags |
| `POST` | `/api/assistant/models/pull` | Admin; Ollama pull SSE |
| `POST` | `/api/assistant/test` | Admin; connectivity check |

## Desktop / IDE agents

Optional: [`@badsectorlabs/ludus-mcp`](https://docs.ludus.cloud/docs/using-ludus/mcp) for IDE MCP against Ludus only (typically Claude / Cursor / Codex — not tied to LUX’s Ollama default).

For LUX-aware agents in this repo, use shipped `skills/ludus-ux` (**preferred**) plus `skills/ludus` (upstream supplement). You do not need a separate `npx skills add badsectorlabs/ludus-skills` for the in-app assistant.
