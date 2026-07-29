#!/usr/bin/env bash
# Smoke-test Ollama from the ludus-ux container (Compose DNS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODEL="${LUX_LLM_MODEL:-qwen2.5:14b}"

echo "== host: Ollama tags =="
curl -sf --max-time 5 http://127.0.0.1:11434/api/tags | head -c 400
echo

echo "== host: short chat (model=$MODEL) =="
curl -sf --max-time 180 http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: pong\"}],\"max_tokens\":16,\"options\":{\"num_ctx\":2048}}" \
  | head -c 500
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not available — host checks only"
  exit 0
fi

echo "== container: DNS + tags via ollama service =="
docker exec ludus-ux sh -c 'wget -qO- --timeout=5 http://ollama:11434/api/tags' | head -c 400
echo

echo "== container: chat via ollama service =="
docker exec -e MODEL="$MODEL" ludus-ux sh -c \
  'wget -qO- --timeout=180 --header="Content-Type: application/json" \
   --post-data="{\"model\":\"'"$MODEL"'\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: pong\"}],\"max_tokens\":16,\"options\":{\"num_ctx\":2048}}" \
   http://ollama:11434/v1/chat/completions' | head -c 500
echo
echo "OK"
