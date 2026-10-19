#!/usr/bin/env bash
# Build a pull request title and ## Summary from CHANGELOG.md.
# Title: vX.Y.Z - Feature, feature, and feature
# Body: written to $LUX_PR_BODY. Includes <!-- lux-pr-summary --> so later
# pipelines can refresh the description until that comment is removed.
# Prints skip=0|1 and title= when skip=0.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
changelog="${LUX_CHANGELOG:-$root/CHANGELOG.md}"

if [[ ! -f "$changelog" ]]; then
  echo "CHANGELOG.md not found: $changelog" >&2
  exit 1
fi

branch="${LUX_PR_BRANCH:-${CI_MERGE_REQUEST_SOURCE_BRANCH_NAME:-${GITHUB_HEAD_REF:-${CI_COMMIT_REF_NAME:-}}}}"
if [[ -z "$branch" ]]; then
  branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi

version="${LUX_PR_VERSION:-}"
if [[ -z "$version" && "$branch" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  version="${BASH_REMATCH[1]}"
fi

extract_section() {
  local mode="$1"
  local want="${2:-}"
  awk -v mode="$mode" -v want="$want" '
    function heading(line) { return line ~ /^## / }
    function selected(line) {
      if (mode == "version") return line ~ ("^## \\[" want "\\]")
      if (mode == "unreleased") return line ~ /^## Unreleased[[:space:]]*$/
      if (mode == "newest") return line ~ /^## \[[0-9]+\.[0-9]+\.[0-9]+\]/
      return 0
    }
    {
      sub(/\r$/, "")
      if (!capture && selected($0)) { capture = 1; next }
      if (capture && heading($0)) exit
      if (capture) print
    }
  ' "$changelog"
}

bullets_of() {
  printf '%s\n' "$1" | sed -n 's/^- \[[A-Za-z][A-Za-z]*\] \(.*\)/- \1/p'
}

section=""
prefix=""
if [[ -n "$version" ]]; then
  section="$(extract_section version "$version")"
  prefix="v${version}"
fi
if [[ -z "$(bullets_of "$section")" ]]; then
  section="$(extract_section unreleased)"
  prefix="Unreleased"
fi
if [[ -z "$(bullets_of "$section")" ]]; then
  section="$(extract_section newest)"
  found="$(sed -n 's/^## \[\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\].*/\1/p' "$changelog" | head -n 1)"
  prefix="v${found}"
fi

bullets="$(bullets_of "$section")"
if [[ -z "$bullets" || -z "$prefix" ]]; then
  printf 'skip=1\n'
  exit 0
fi

titles=()
while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  titles+=("$name")
  if [[ ${#titles[@]} -eq 3 ]]; then
    break
  fi
done < <(printf '%s\n' "$bullets" | sed -n 's/^- \*\*\([^*]*\)\*\*.*/\1/p' | awk 'NF && !seen[$0]++ { gsub(/[[:space:]]+$/, ""); print }')

if [[ ${#titles[@]} -eq 0 ]]; then
  printf 'skip=1\n'
  exit 0
fi

if [[ ${#titles[@]} -eq 1 ]]; then
  short="${titles[0]}"
elif [[ ${#titles[@]} -eq 2 ]]; then
  short="${titles[0]} and ${titles[1]}"
else
  short="${titles[0]}, ${titles[1]}, and ${titles[2]}"
fi
title="${prefix} - ${short}"

body="$(printf '## Summary\n\n%s\n\n<!-- lux-pr-summary -->\n' "$bullets")"
if [[ -n "${LUX_PR_BODY:-}" ]]; then
  printf '%s\n' "$body" >"$LUX_PR_BODY"
else
  printf '%s\n' "$body"
fi

printf 'skip=0\n'
printf 'title=%s\n' "$title"
