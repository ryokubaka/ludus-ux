#!/usr/bin/env bash
# Read the newest versioned section of CHANGELOG.md and print a GitHub release.
# Tag: vX.Y.Z
# Title: vX.Y.Z — short description from that section's feature titles
# Notes: the section, written to $LUX_RELEASE_NOTES when that path is set.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
changelog="${LUX_CHANGELOG:-$root/CHANGELOG.md}"

if [[ ! -f "$changelog" ]]; then
  echo "CHANGELOG.md not found: $changelog" >&2
  exit 1
fi

version="$(sed -n 's/^## \[\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\].*/\1/p' "$changelog" | head -n 1)"
if [[ -z "$version" ]]; then
  echo "No versioned heading in $changelog (expected ## [X.Y.Z])" >&2
  exit 1
fi

section="$(
  awk '
    /^## \[[0-9]+\.[0-9]+\.[0-9]+\]/ {
      if (in_section) exit
      in_section = 1
      print
      next
    }
    in_section && /^## / { exit }
    in_section { print }
  ' "$changelog"
)"

desc="$(
  printf '%s\n' "$section" \
    | sed -n 's/^- \[[A-Za-z][A-Za-z]*\] \*\*\([^*]*\)\*\*.*/\1/p' \
    | awk 'NF && !seen[$0]++ && count < 3 { gsub(/[[:space:]]+$/, ""); titles[++count] = $0 } END {
        for (i = 1; i <= count; i++) printf "%s%s", (i == 1 ? "" : ", "), titles[i]
      }'
)"

tag="v${version}"
if [[ -n "$desc" ]]; then
  title="${tag} — ${desc}"
else
  title="$tag"
fi

notes="$(printf '%s\n' "$section" | awk 'NF { started = 1 } started { lines[++n] = $0 } END {
  while (n > 0 && lines[n] ~ /^[[:space:]]*$/) n--
  for (i = 1; i <= n; i++) print lines[i]
}')"

printf 'tag=%s\n' "$tag"
printf 'title=%s\n' "$title"
if [[ -n "${LUX_RELEASE_NOTES:-}" ]]; then
  printf '%s\n' "$notes" >"$LUX_RELEASE_NOTES"
else
  printf '\n%s\n' "$notes"
fi
