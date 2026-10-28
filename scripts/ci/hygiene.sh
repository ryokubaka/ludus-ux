#!/usr/bin/env bash
# Committed symlinks, lockfile links, secrets files, and deployment details in CI files.
. "$(dirname "$0")/lib.sh"

lux_step "repo hygiene"
node scripts/check-repo-hygiene.mjs
