# shellcheck disable=SC2034 # the image variables are read by the scripts that source this file
# Shared by scripts/ci/*.sh. Each check runs the same on a GitHub runner,
# a GitLab job, and a developer machine: bash, Node 24, and (for some) Docker.
set -euo pipefail

LUX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$LUX_ROOT"

# Container images used when the tool is not on PATH. Pinned by digest; a GitLab
# job can use the same image directly so the tool is already present.
LUX_GITLEAKS_IMAGE="zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
LUX_SEMGREP_IMAGE="semgrep/semgrep:1.185.0@sha256:67518c174185a2043fdbed16c70631b79209499b3671178e7194379b48295a0d"
LUX_KANIKO_IMAGE="gcr.io/kaniko-project/executor:v1.23.2-debug@sha256:c3109d5926a997b100c4343944e06c6b30a6804b2f9abe0994d3de6ef92b028e"
# Slim Node 24. The full CI image is trixie (FIPS-safe apt); this one is the
# same major, small enough to keep on a Windows machine. Digest matches
# scripts/ci/unit.Dockerfile.
LUX_NODE_IMAGE="node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0"
LUX_UNIT_IMAGE="lux-ci-unit:node24"

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
  local base=""
  if [[ -n "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}" ]]; then
    base="$CI_MERGE_REQUEST_DIFF_BASE_SHA"
  elif [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    git fetch --quiet --depth=200 origin "$GITHUB_BASE_REF" 2>/dev/null || true
    base="$(git merge-base HEAD "origin/$GITHUB_BASE_REF" 2>/dev/null || true)"
  elif [[ -n "${LUX_CI_DIFF_BASE:-}" ]]; then
    base="$LUX_CI_DIFF_BASE"
  fi
  if [[ -n "$base" ]] && ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    git fetch --quiet --depth=200 origin "$base" 2>/dev/null || true
  fi
  printf '%s' "$base"
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

# Host path for docker build and bind mounts. Git Bash's //e/... form is only
# a volume alias; docker build looks that string up as a directory and fails.
# cygpath -m yields E:/..., which build and -v both open.
lux_docker_bind() {
  if lux_have cygpath; then
    cygpath -m "$1"
    return 0
  fi
  printf '%s' "$1"
}

lux_windows_host() {
  case "${OSTYPE:-}" in
    msys*|cygwin*|win32*) return 0 ;;
  esac
  [[ -n "${MSYSTEM:-}" ]] && return 0
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  return 1
}

# True when this checkout's native addon was built for Windows. A WSL shell
# cannot load it, and Git Bash is the wrong host for the Bash spawn tests.
lux_windows_node_modules() {
  local bin="$LUX_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  [[ -f "$bin" ]] || return 1
  lux_have file || return 1
  file "$bin" | grep -q 'PE32'
}

lux_unit_needs_docker() {
  [[ "${LUX_INSIDE_UNIT_DOCKER:-}" == "1" ]] && return 1
  case "${LUX_UNIT_DOCKER:-}" in
    0) return 1 ;;
    1) return 0 ;;
  esac
  lux_windows_host && return 0
  lux_windows_node_modules
}

lux_unit_volume() {
  local id
  if lux_have sha256sum; then
    id="$(printf '%s' "$LUX_ROOT" | sha256sum | awk '{print substr($1, 1, 12)}')"
  else
    id="$(printf '%s' "$LUX_ROOT" | cksum | awk '{print $1}')"
  fi
  printf 'lux-ci-unit-%s' "$id"
}

# Re-exec unit.sh in Linux. The node_modules volume hides the Windows install.
lux_unit_docker() {
  lux_have docker || {
    echo "On Windows the unit suite runs in a Linux Node container. Start Docker Desktop, or set LUX_UNIT_DOCKER=0 to run it with this machine's Node." >&2
    exit 1
  }
  local root vol
  root="$(lux_docker_bind "$LUX_ROOT")"
  vol="$(lux_unit_volume)"
  echo "Unit tests run in Linux so Bash paths match CI. This checkout's node_modules is not replaced."
  lux_step "unit image"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker build \
    --build-arg "NODE_IMAGE=${LUX_NODE_IMAGE}" \
    -f "${root}/scripts/ci/unit.Dockerfile" \
    -t "$LUX_UNIT_IMAGE" \
    "${root}/scripts/ci"
  lux_step "unit suite in ${LUX_UNIT_IMAGE}"
  local -a env_args=()
  env_args+=(-e LUX_INSIDE_UNIT_DOCKER=1)
  # SQLite WAL on Docker Desktop's Windows mount returns SQLITE_IOERR_SHORT_READ.
  # The suite's database is the one read at process start, so keep it on the
  # container filesystem. The checkout's data/ directory is left alone.
  env_args+=(-e DATA_DIR=/tmp/lux-unit-data)
  env_args+=(-e LUX_VITEST_MAX_WORKERS=1)
  env_args+=(-e "LUX_TEST_REQUIRE_CAPS=${LUX_TEST_REQUIRE_CAPS:-pyyaml,visudo}")
  [[ -n "${LUX_CI_SKIP_INSTALL:-}" ]] && env_args+=(-e "LUX_CI_SKIP_INSTALL=${LUX_CI_SKIP_INSTALL}")
  [[ -n "${CI:-}" ]] && env_args+=(-e "CI=${CI}")
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker run --rm \
    "${env_args[@]}" \
    -v "${root}:/src" \
    -v "${vol}:/src/node_modules" \
    -v lux-ci-unit-npm:/root/.npm \
    -w /src \
    "$LUX_UNIT_IMAGE" \
    bash scripts/ci/unit.sh
}
