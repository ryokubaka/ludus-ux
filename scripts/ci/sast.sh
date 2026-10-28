#!/usr/bin/env bash
# Semgrep: public TypeScript/Node rule packs plus this repo's rules in .semgrep/.
# Same rules on GitHub and GitLab. GitHub also runs CodeQL (see .github/workflows/ci.yml).
. "$(dirname "$0")/lib.sh"

args=(
  scan
  --metrics=off
  --error
  --config p/typescript
  --config p/nodejs
  --config p/command-injection
  --config .semgrep/
  # Rule test fixtures (semgrep --test .semgrep/) contain the patterns on purpose.
  --exclude .semgrep
)

# Reviewed false positives. Each line in .semgrep-excluded-rules says why.
while read -r rule _; do
  [[ -z "$rule" || "$rule" == \#* ]] && continue
  args+=(--exclude-rule "$rule")
done < .semgrep-excluded-rules

lux_step "semgrep"
if lux_have semgrep; then
  semgrep "${args[@]}" .
else
  lux_docker_run "$LUX_SEMGREP_IMAGE" semgrep "${args[@]}" .
fi
