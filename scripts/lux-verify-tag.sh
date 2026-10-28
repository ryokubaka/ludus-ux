#!/usr/bin/env bash
# Verify a release tag in a keyring that contains only LUX_UPGRADE_TRUSTED_KEY.
# Sourced by scripts/upgrade.sh. A missing variable skips the check.
lux_verify_signed_tag() {
  local target="$1" home status
  if [[ -z "${LUX_UPGRADE_TRUSTED_KEY:-}" ]]; then
    return 0
  fi
  if [[ ! -f "$LUX_UPGRADE_TRUSTED_KEY" ]]; then
    echo "Error: LUX_UPGRADE_TRUSTED_KEY must be a public key file." >&2
    return 1
  fi
  if [[ -n "${LUX_UPGRADE_TRUSTED_FPR:-}" && ! "${LUX_UPGRADE_TRUSTED_FPR}" =~ ^[A-Fa-f0-9]{40}([A-Fa-f0-9]{24})?$ ]]; then
    echo "Error: LUX_UPGRADE_TRUSTED_FPR must be a hex fingerprint." >&2
    return 1
  fi
  home="$(mktemp -d)"
  chmod 700 "$home" || {
    rm -rf "$home"
    echo "Error: could not prepare a keyring." >&2
    return 1
  }
  if ! GNUPGHOME="$home" gpg --batch --quiet --import "$LUX_UPGRADE_TRUSTED_KEY"; then
    rm -rf "$home"
    echo "Error: could not import LUX_UPGRADE_TRUSTED_KEY." >&2
    return 1
  fi
  if ! status="$(GNUPGHOME="$home" git verify-tag --raw "$target" 2>&1)"; then
    rm -rf "$home"
    echo "Error: tag '$target' failed signature verification." >&2
    return 1
  fi
  rm -rf "$home"
  if [[ -n "${LUX_UPGRADE_TRUSTED_FPR:-}" ]] &&
    ! grep -Eq "^\[GNUPG:\] VALIDSIG .* ${LUX_UPGRADE_TRUSTED_FPR}\$" <<<"$status"; then
    echo "Error: tag '$target' is not signed by ${LUX_UPGRADE_TRUSTED_FPR}." >&2
    return 1
  fi
}
