#!/usr/bin/env bash
# Build and start the compose stack with a throwaway .env, then wait for /api/health.
# Needs Docker. Refuses to overwrite an existing .env.
. "$(dirname "$0")/lib.sh"

if [[ -f .env && "${LUX_CI_OVERWRITE_ENV:-}" != "1" ]]; then
  echo "A .env already exists here. Run the smoke test in a clean checkout (CI does), or set LUX_CI_OVERWRITE_ENV=1." >&2
  exit 1
fi

project="${LUX_CI_SMOKE_PROJECT:-luxsmoke}"
export COMPOSE_PROJECT_NAME="$project"
# Docker-in-Docker on GitLab publishes ports on the "docker" service host.
host="${LUX_CI_SMOKE_HOST:-127.0.0.1}"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  if [[ "${LUX_CI_OVERWRITE_ENV:-}" != "1" ]]; then rm -f .env; fi
}
trap cleanup EXIT

sh ci/write-ci-env.sh
lux_step "compose build"
docker compose build --progress=plain
lux_step "compose up"
docker compose up -d

lux_step "wait for /api/health"
for _ in $(seq 1 90); do
  if curl -kfsS "https://$host/api/health" >/dev/null 2>&1; then
    curl -kfsS "https://$host/api/health" | head -c 500
    echo
    exit 0
  fi
  sleep 2
done
echo "Health check failed. Logs:" >&2
docker compose logs --no-color --tail=200 >&2 || true
exit 1
