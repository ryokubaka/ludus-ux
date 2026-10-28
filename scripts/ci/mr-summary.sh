#!/usr/bin/env bash
# Set the open merge request title and description from CHANGELOG.md.
# Same text as the GitHub pull request job. A hand-edited description
# (a Summary section with the lux-pr-summary comment removed) is left alone.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if [[ -z "${CI_MERGE_REQUEST_IID:-}" || -z "${CI_API_V4_URL:-}" || -z "${CI_PROJECT_ID:-}" ]]; then
  echo "mr-summary.sh runs in a GitLab merge request pipeline." >&2
  exit 1
fi
if [[ "${CI_MERGE_REQUEST_SOURCE_PROJECT_ID:-$CI_PROJECT_ID}" != "$CI_PROJECT_ID" ]]; then
  echo "Fork merge requests are not updated"
  exit 0
fi
if [[ -z "${GITLAB_TOKEN:-}" ]]; then
  echo "GITLAB_TOKEN is not set. Create a project access token with the Maintainer role and the api scope, then add it as a masked CI/CD variable named GITLAB_TOKEN. Leave it unprotected so merge request pipelines can read it. The CI job token cannot edit a merge request." >&2
  exit 1
fi
# shellcheck source=gitlab-trust.sh
source "$(dirname "$0")/gitlab-trust.sh"
lux_trust_gitlab_api

mr_json="$(mktemp)"
body_file="$(mktemp)"
# gitlab-api.mjs refuses a body outside this checkout, so the payload cannot live in /tmp.
payload="$(mktemp "${root}/.gitlab-api.XXXXXX")"
trap 'rm -f "$mr_json" "$body_file" "$payload"' EXIT

node scripts/ci/gitlab-api.mjs GET "/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}" >"$mr_json"
description="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; const d=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(d.description ?? "")' "$mr_json")"

if ! printf '%s\n' "$description" | bash scripts/pr-summary-should-replace.sh; then
  echo "Description was edited by hand; leaving it"
  exit 0
fi

parsed="$(LUX_PR_BODY="$body_file" bash scripts/changelog-pr.sh)"
skip="$(printf '%s\n' "$parsed" | sed -n 's/^skip=//p')"
if [[ "$skip" == "1" ]]; then
  echo "No changelog bullets to summarize"
  exit 0
fi
title="$(printf '%s\n' "$parsed" | sed -n 's/^title=//p')"

# Keep ticks on the security checklist from the merge request template.
checklist="$(printf '%s\n' "$description" | awk '/^## Security checklist/{keep=1} keep')"
if [[ -n "$checklist" ]]; then
  printf '\n%s\n' "$checklist" >>"$body_file"
fi

LUX_MR_TITLE="$title" LUX_MR_BODY="$body_file" LUX_MR_JSON="$payload" node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs"
writeFileSync(process.env.LUX_MR_JSON, JSON.stringify({
  title: process.env.LUX_MR_TITLE,
  description: readFileSync(process.env.LUX_MR_BODY, "utf8"),
}))
JS

node scripts/ci/gitlab-api.mjs PUT "/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}" "$payload" >/dev/null
echo "Updated merge request !${CI_MERGE_REQUEST_IID}: ${title}"
