#!/usr/bin/env bash
# CHANGELOG.md structure: tags, order, duplicate titles, version header.
. "$(dirname "$0")/lib.sh"

lux_step "changelog"
node scripts/check-changelog.mjs
