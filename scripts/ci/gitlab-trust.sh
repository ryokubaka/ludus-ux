# Point Node at the CA that signed this GitLab, before any node process starts.
# Node reads NODE_EXTRA_CA_CERTS only at startup. The public CA list in the
# job image does not include a private CA, so fetch fails with
# UNABLE_TO_VERIFY_LEAF_SIGNATURE until one of these is set.
lux_trust_gitlab_api() {
  if [[ -n "${NODE_EXTRA_CA_CERTS:-}" ]]; then
    return 0
  fi
  local src=""
  if [[ -n "${CI_SERVER_TLS_CA_FILE:-}" && -f "${CI_SERVER_TLS_CA_FILE}" ]]; then
    src="${CI_SERVER_TLS_CA_FILE}"
    echo "Trusting the GitLab API certificate from CI_SERVER_TLS_CA_FILE"
  elif [[ -n "${GITLAB_CA_CERT:-}" && -f "${GITLAB_CA_CERT}" ]]; then
    src="${GITLAB_CA_CERT}"
    echo "Trusting the GitLab API certificate from GITLAB_CA_CERT"
  elif [[ "${GITLAB_CA_CERT:-}" == *"BEGIN CERTIFICATE"* ]]; then
    src="$(mktemp)"
    printf '%s\n' "$GITLAB_CA_CERT" >"$src"
    echo "Trusting the GitLab API certificate from GITLAB_CA_CERT"
  fi
  if [[ -n "$src" ]]; then
    export NODE_EXTRA_CA_CERTS="$src"
  fi
}
