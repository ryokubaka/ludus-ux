#!/usr/bin/env bash
# Unit tests, lint, and typecheck.
# On Windows, or when node_modules is a Windows build, this re-execs in
# scripts/ci/unit.Dockerfile. LUX_UNIT_DOCKER=0 stays here. LUX_UNIT_DOCKER=1
# forces the container.
. "$(dirname "$0")/lib.sh"

if lux_unit_needs_docker; then
  lux_unit_docker
  exit 0
fi

lux_npm_install
lux_step "vitest"
npm run test:unit
lux_step "eslint"
npm run lint
lux_step "tsc"
npm run lint:types
