# Slim Node 24 for the unit step on Windows. Same major as CI
# (.gitlab/ci.yml NODE_IMAGE) plus the OS packages that job installs.
# scripts/ci/lib.sh passes NODE_IMAGE; keep this default in sync with LUX_NODE_IMAGE.
ARG NODE_IMAGE=node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
FROM ${NODE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    python3-yaml \
    sudo \
    git \
    ca-certificates \
    openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system --add safe.directory '*'
