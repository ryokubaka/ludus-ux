#!/usr/bin/env bash
# Route audit, argv secret audit, path segment audit, origin gate, and the
# advisory regression catalog. Writes security-checklist-part.json for the
# pull request checklist even when a test fails.
. "$(dirname "$0")/lib.sh"

base="$(lux_diff_base || true)"
if [[ -n "$base" ]]; then
  export LUX_CI_DIFF_BASE="$base"
fi

lux_npm_install
lux_step "security tests"
report="${LUX_ROOT}/security-vitest.json"
set +e
npm run test:security -- --reporter=default --reporter=json --outputFile="$report"
code=$?
set -e
node scripts/ci/security-checklist.mjs from-vitest "$report" >"${LUX_ROOT}/security-checklist-part.json"
exit "$code"
