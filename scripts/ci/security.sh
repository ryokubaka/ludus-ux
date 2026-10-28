#!/usr/bin/env bash
# Route audit, argv secret audit, and the advisory regression catalog.
. "$(dirname "$0")/lib.sh"

lux_npm_install
lux_step "security tests"
npm run test:security
