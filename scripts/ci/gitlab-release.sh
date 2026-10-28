#!/usr/bin/env bash
# After a merge to the default branch, tag vX.Y.Z and publish that changelog
# section. A tag that already has a release is left alone.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if [[ -z "${CI_API_V4_URL:-}" || -z "${CI_PROJECT_ID:-}" || -z "${CI_COMMIT_SHA:-}" ]]; then
  echo "gitlab-release.sh runs in a GitLab pipeline on the default branch." >&2
  exit 1
fi
if [[ -z "${GITLAB_TOKEN:-}" ]]; then
  echo "GITLAB_TOKEN is not set. Create a project access token with the Maintainer role and the api scope, then add it as a masked CI/CD variable named GITLAB_TOKEN." >&2
  exit 1
fi
# shellcheck source=gitlab-trust.sh
source "$(dirname "$0")/gitlab-trust.sh"
lux_trust_gitlab_api

notes="$(mktemp)"
# gitlab-api.mjs refuses a body outside this checkout, so the payload cannot live in /tmp.
payload="$(mktemp "${root}/.gitlab-api.XXXXXX")"
trap 'rm -f "$notes" "$payload"' EXIT

parsed="$(LUX_RELEASE_NOTES="$notes" bash scripts/changelog-release.sh)"
tag="$(printf '%s\n' "$parsed" | sed -n 's/^tag=//p')"
title="$(printf '%s\n' "$parsed" | sed -n 's/^title=//p')"
encoded="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$tag")"

set +e
node scripts/ci/gitlab-api.mjs GET "/projects/${CI_PROJECT_ID}/releases/${encoded}" >/dev/null
rc=$?
set -e
if [[ "$rc" -eq 0 ]]; then
  echo "Release ${tag} already exists"
  exit 0
fi
if [[ "$rc" -ne 5 ]]; then
  exit "$rc"
fi

LUX_RELEASE_TAG="$tag" LUX_RELEASE_TITLE="$title" LUX_RELEASE_NOTES="$notes" LUX_RELEASE_REF="$CI_COMMIT_SHA" LUX_RELEASE_JSON="$payload" node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs"
writeFileSync(process.env.LUX_RELEASE_JSON, JSON.stringify({
  name: process.env.LUX_RELEASE_TITLE,
  tag_name: process.env.LUX_RELEASE_TAG,
  description: readFileSync(process.env.LUX_RELEASE_NOTES, "utf8"),
  ref: process.env.LUX_RELEASE_REF,
}))
JS

set +e
node scripts/ci/gitlab-api.mjs POST "/projects/${CI_PROJECT_ID}/releases" "$payload" >/dev/null
rc=$?
set -e
if [[ "$rc" -eq 6 ]]; then
  echo "Release ${tag} already exists"
  exit 0
fi
if [[ "$rc" -ne 0 ]]; then
  exit "$rc"
fi
echo "Published ${tag}"
