#!/usr/bin/env bash
# Build docker/Dockerfile with Kaniko (no push). Needs Docker. The GitLab job
# runs the same executor arguments inside the Kaniko image, which has no bash.
. "$(dirname "$0")/lib.sh"

lux_step "kaniko build"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(lux_host_path "$LUX_ROOT"):/workspace" \
  "$LUX_KANIKO_IMAGE" \
  --context /workspace \
  --dockerfile /workspace/docker/Dockerfile \
  --no-push \
  --destination ludus-ux:ci
