#!/usr/bin/env bash
# Exit 0 when CI should replace the current pull request description.
# A ## Summary without the lux-pr-summary comment was edited by hand.
set -euo pipefail

body="$(cat)"
if printf '%s\n' "$body" | grep -q 'lux-pr-summary'; then
  exit 0
fi
if printf '%s\n' "$body" | grep -q '^## Summary[[:space:]]*$'; then
  exit 1
fi
exit 0
