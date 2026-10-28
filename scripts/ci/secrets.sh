#!/usr/bin/env bash
# Secrets in this change (PR/MR range) and in the current tree.
. "$(dirname "$0")/lib.sh"

run_gitleaks() {
  if lux_have gitleaks; then
    gitleaks "$@"
  else
    lux_docker_run "$LUX_GITLEAKS_IMAGE" "$@"
  fi
}

lux_step "gitleaks: tracked files"
# Scan only what git tracks, so local .env files and node_modules never count.
scan_dir="$(mktemp -d "${TMPDIR:-/tmp}/lux-gitleaks.XXXXXX")"
trap 'rm -rf "$scan_dir"' EXIT
# Newline-separated so BusyBox tar (the gitleaks and Semgrep images) can read it.
git -c core.quotePath=false ls-files | while IFS= read -r f; do
  [[ -e "$f" || -L "$f" ]] && printf '%s\n' "$f"
done | tar -cf - -T - | tar -xf - -C "$scan_dir"
if lux_have gitleaks; then
  gitleaks dir --config .gitleaks.toml --redact --verbose --no-banner "$scan_dir"
else
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(lux_host_path "$scan_dir"):/scan" \
    -v "$(lux_host_path "$LUX_ROOT/.gitleaks.toml"):/config.toml:ro" \
    "$LUX_GITLEAKS_IMAGE" dir --config /config.toml --redact --verbose --no-banner /scan
fi

base="$(lux_diff_base)"
if [[ -n "$base" ]]; then
  lux_step "gitleaks: commits since $base"
  run_gitleaks git --config .gitleaks.toml --redact --verbose --no-banner --log-opts="$base..HEAD" .
fi
