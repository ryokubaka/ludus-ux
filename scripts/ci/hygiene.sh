#!/usr/bin/env bash
# Committed symlinks, lockfile links, secrets files, deployment details in CI
# files, and documentation that no longer matches the code.
. "$(dirname "$0")/lib.sh"

lux_step "repo hygiene"
node scripts/check-repo-hygiene.mjs

lux_step "doc drift"
node scripts/check-doc-drift.mjs
