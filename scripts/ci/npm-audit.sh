#!/usr/bin/env bash
# Known-vulnerable dependencies at high severity or worse.
. "$(dirname "$0")/lib.sh"

lux_npm_install
lux_step "npm audit"
npm audit --audit-level=high
