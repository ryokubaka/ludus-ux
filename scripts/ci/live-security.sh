#!/usr/bin/env bash
# Live security gate: unit tests, repo hygiene with this deployment's values,
# and the Playwright `security` project against a running LUX, then the
# `security-gate/live` commit status on GitHub and/or GitLab.
#
# Settings come from the environment or a gitignored .security-gate.env:
#   E2E_ADMIN_USER, E2E_ADMIN_PASSWORD   Ludus admin used to create and delete the throwaway user
#   E2E_LUDUS_API_KEY                    admin API key, only if login asks for it
#   PLAYWRIGHT_BASE_URL                  LUX to test; unset = build and start this checkout
#   GITHUB_TOKEN                         post the status to GitHub (repo:status)
#   GITLAB_TOKEN, GITLAB_URL, GITLAB_PROJECT   post the status to GitLab (api scope; project path or id)
#   LUX_GATE_SKIP_UNIT=1                 skip unit.sh (the CI pipeline already ran it)
#   SECURITY_GATE_UPGRADE=1              also replay an upgrade from the previous release tag
#   SECURITY_GATE_ALLOW_DIRTY=1          run with uncommitted changes (no status is posted)
. "$(dirname "$0")/lib.sh"

if [[ -f .security-gate.env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.security-gate.env
  set +a
fi

: "${E2E_ADMIN_USER:?Set E2E_ADMIN_USER (environment or .security-gate.env)}"
: "${E2E_ADMIN_PASSWORD:?Set E2E_ADMIN_PASSWORD (environment or .security-gate.env)}"
export E2E_ADMIN_USER E2E_ADMIN_PASSWORD

sha="$(git rev-parse HEAD)"
dirty=""
[[ -n "$(git status --porcelain --untracked-files=no)" ]] && dirty=1
if [[ -n "$dirty" && "${SECURITY_GATE_ALLOW_DIRTY:-}" != "1" ]]; then
  echo "Uncommitted changes: the result would not describe $sha. Commit first, or set SECURITY_GATE_ALLOW_DIRTY=1 (no status is posted)." >&2
  exit 1
fi

# --- Commit status ----------------------------------------------------------
STATUS_CONTEXT="security-gate/live"

github_repo() {
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then printf '%s' "$GITHUB_REPOSITORY"; return; fi
  git remote get-url origin 2>/dev/null | sed -nE 's#^(https://|git@)github\.com[/:]([^/]+/[^/.]+)(\.git)?$#\2#p'
}

post_status() {
  local state="$1" description="$2"
  [[ -n "$dirty" ]] && return 0
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    local repo gh_state="$state"
    repo="$(github_repo)"
    [[ "$state" == "failed" ]] && gh_state="failure"
    if [[ -n "$repo" ]]; then
      # Token on stdin, not in curl's argv.
      printf 'Authorization: Bearer %s\n' "$GITHUB_TOKEN" | curl -fsS -o /dev/null -H @- \
        -H "Accept: application/vnd.github+json" \
        -d "{\"state\":\"$gh_state\",\"context\":\"$STATUS_CONTEXT\",\"description\":\"$description\"}" \
        "https://api.github.com/repos/$repo/statuses/$sha" || echo "Could not post the GitHub status" >&2
    fi
  fi
  if [[ -n "${GITLAB_TOKEN:-}" ]]; then
    local api="${CI_API_V4_URL:-${GITLAB_URL:+${GITLAB_URL%/}/api/v4}}"
    local project="${CI_PROJECT_ID:-${GITLAB_PROJECT:-}}"
    local gl_state="$state"
    [[ "$state" == "pending" ]] && gl_state="running"
    if [[ -n "$api" && -n "$project" ]]; then
      project="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$project")"
      printf 'PRIVATE-TOKEN: %s\n' "$GITLAB_TOKEN" | curl -fsS -o /dev/null -H @- \
        --data-urlencode "state=$gl_state" \
        --data-urlencode "name=$STATUS_CONTEXT" \
        --data-urlencode "description=$description" \
        "$api/projects/$project/statuses/$sha" || echo "Could not post the GitLab status" >&2
    else
      echo "GITLAB_TOKEN is set but GITLAB_URL or GITLAB_PROJECT is not; skipping the GitLab status" >&2
    fi
  fi
}

finish() {
  local code=$?
  if [[ $code -eq 0 ]]; then post_status success "Live security suite passed"
  else post_status failed "Live security suite failed"; fi
  if declare -F lux_gate_cleanup >/dev/null; then lux_gate_cleanup; fi
  exit $code
}
trap finish EXIT
post_status pending "Live security suite running"

# --- Target -------------------------------------------------------------------
wait_healthy() {
  local url="$1"
  for _ in $(seq 1 120); do
    curl -kfsS "$url/api/health" >/dev/null 2>&1 && return 0
    sleep 3
  done
  echo "LUX at $url did not become healthy" >&2
  docker compose logs --no-color --tail=100 >&2 2>/dev/null || true
  return 1
}

if [[ "${SECURITY_GATE_UPGRADE:-}" == "1" ]]; then
  # shellcheck source=upgrade-replay.sh
  . "$(dirname "$0")/upgrade-replay.sh"
  lux_upgrade_replay
  export PLAYWRIGHT_BASE_URL="https://localhost"
elif [[ -z "${PLAYWRIGHT_BASE_URL:-}" ]]; then
  test -f .env || { echo "No .env: set PLAYWRIGHT_BASE_URL, or create .env to build this checkout" >&2; exit 1; }
  lux_step "build and start this checkout"
  docker compose up -d --build
  export PLAYWRIGHT_BASE_URL="https://localhost"
  wait_healthy "$PLAYWRIGHT_BASE_URL"
else
  wait_healthy "$PLAYWRIGHT_BASE_URL"
fi

# --- Checks -------------------------------------------------------------------
if [[ "${LUX_GATE_SKIP_UNIT:-}" != "1" ]]; then
  bash "$(dirname "$0")/unit.sh"
else
  lux_npm_install
fi

lux_step "repo hygiene with this deployment's values"
node scripts/check-repo-hygiene.mjs

lux_step "live security suite against $(node -e 'process.stdout.write(new URL(process.argv[1]).host)' "$PLAYWRIGHT_BASE_URL")"
npx playwright test -c config/playwright.config.ts --project security
