#!/usr/bin/env bash
# CHANGELOG.md structure: tags, order, duplicate titles, version header.
# On a pull request, a product change also needs a new tagged bullet.
. "$(dirname "$0")/lib.sh"

base="$(lux_diff_base || true)"
if [[ -n "$base" ]]; then
  export LUX_CI_DIFF_BASE="$base"
fi

lux_step "changelog"
node scripts/check-changelog.mjs
