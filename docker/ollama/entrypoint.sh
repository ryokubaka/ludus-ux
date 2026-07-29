#!/bin/sh
set -eu
MODEL="${LUX_OLLAMA_DEFAULT_MODEL:-qwen2.5:14b}"

# Server must listen on all interfaces (Compose + published host port).
# CLI clients must talk to loopback — OLLAMA_HOST=0.0.0.0 breaks `ollama pull/list`.
OLLAMA_HOST=0.0.0.0:11434 ollama serve &
pid=$!
export OLLAMA_HOST=127.0.0.1:11434

# ollama image has neither wget nor curl — readiness must use the CLI (same as healthcheck).
api_ready() {
  ollama list >/dev/null 2>&1
}

echo "[lux-ollama] waiting for API..."
i=0
while [ "$i" -lt 120 ]; do
  if api_ready; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

if ! api_ready; then
  echo "[lux-ollama] API did not become ready" >&2
  kill "$pid" 2>/dev/null || true
  exit 1
fi

has_model() {
  ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$MODEL" \
    || ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -q "^${MODEL}:"
}

# Pull in background so a slow first download never blocks / restarts the container.
# Partial blobs resume; Settings → AI pull can run in parallel safely enough.
if ! has_model; then
  echo "[lux-ollama] pulling default model in background: $MODEL"
  (
    if ollama pull "$MODEL"; then
      echo "[lux-ollama] default model ready: $MODEL"
    else
      echo "[lux-ollama] default model pull failed: $MODEL (retry via Settings → AI)" >&2
    fi
  ) &
else
  echo "[lux-ollama] model already present: $MODEL"
fi

echo "[lux-ollama] ready — models:"
ollama list 2>/dev/null || true

wait "$pid"
