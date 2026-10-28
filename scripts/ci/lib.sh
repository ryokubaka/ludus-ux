# shellcheck disable=SC2034 # the image variables are read by the scripts that source this file
# Shared by scripts/ci/*.sh. Each check runs the same on a GitHub runner,
# a GitLab job, and a developer machine: bash, Node 24, and (for some) Docker.
set -euo pipefail

LUX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$LUX_ROOT"

# Container images used when the tool is not on PATH. Pinned by digest; a GitLab
# job can use the same image directly so the tool is already present.
LUX_GITLEAKS_IMAGE="zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
LUX_SEMGREP_IMAGE="semgrep/semgrep:1.181.1@sha256:3db5c7af55eb1f512eac0abf0ab69a97b52c74b5e9a27314c221aee1a78d7ab2"
LUX_KANIKO_IMAGE="gcr.io/kaniko-project/executor:v1.23.2-debug@sha256:c3109d5926a997b100c4343944e06c6b30a6804b2f9abe0994d3de6ef92b028e"

lux_step() {
  printf '\n== %s ==\n' "$*"
}

# npm ci once per checkout. LUX_CI_SKIP_INSTALL=1 reuses node_modules (local runs).
lux_npm_install() {
  if [[ "${LUX_CI_SKIP_INSTALL:-}" == "1" && -d node_modules ]]; then
    return 0
  fi
  test -f package-lock.json || {
    echo "package-lock.json is missing. Run: npm install --legacy-peer-deps" >&2
    exit 1
  }
  lux_step "npm ci"
  npm ci --legacy-peer-deps --no-audit --no-fund
}

# Base commit for "changes in this PR/MR". Empty on a push to main or locally.
lux_diff_base() {
  if [[ -n "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}" ]]; then
    printf '%s' "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
  elif [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    git fetch --quiet --depth=200 origin "$GITHUB_BASE_REF" 2>/dev/null || true
    git merge-base HEAD "origin/$GITHUB_BASE_REF" 2>/dev/null || true
  elif [[ -n "${LUX_CI_DIFF_BASE:-}" ]]; then
    printf '%s' "$LUX_CI_DIFF_BASE"
  fi
}

lux_have() {
  command -v "$1" >/dev/null 2>&1
}

lux_docker_run() {
  local image="$1"
  shift
  lux_have docker || {
    echo "Needs either the tool on PATH or Docker to run $image" >&2
    exit 1
  }
  local workdir
  workdir="$(lux_host_path "$LUX_ROOT")"
  MSYS_NO_PATHCONV=1 docker run --rm -v "$workdir:/src" -w /src "$image" "$@"
}

# Docker Desktop on Windows needs a native path for bind mounts.
lux_host_path() {
  if lux_have cygpath; then cygpath -w "$1"; else printf '%s' "$1"; fi
}
