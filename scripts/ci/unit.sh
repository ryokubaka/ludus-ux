#!/usr/bin/env bash
# Unit tests, lint, and typecheck.
. "$(dirname "$0")/lib.sh"

lux_npm_install
lux_step "vitest"
npm run test:unit
lux_step "eslint"
npm run lint
lux_step "tsc"
npm run lint:types
