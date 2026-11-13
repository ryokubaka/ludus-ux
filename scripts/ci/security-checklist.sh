#!/usr/bin/env bash
# Tick each security-checklist item on the open pull request or merge request
# when the matching check passed. The live box follows security-gate/live.
# Exits 1 when any item except the live suite failed.
. "$(dirname "$0")/lib.sh"

if [[ ! -f security-checklist-part.json ]]; then
  echo "security-checklist-part.json is missing. The security job did not report item results." >&2
fi

exec node scripts/ci/security-checklist.mjs sync
