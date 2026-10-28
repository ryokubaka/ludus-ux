# Sourced by live-security.sh when SECURITY_GATE_UPGRADE=1.
#
# Replays an upgrade the way an operator does it: a scratch clone at the
# previous release tag, started with an .env that has no LUDUS_TLS_INSECURE
# (as older quickstarts wrote it), then that release's own upgrade.sh to the
# current branch. Afterwards the app user must still read the SSH key (directly
# or through the /run/lux-ssh copy), and a Ludus certificate that does not
# verify must produce the "LUDUS_TLS_INSECURE is not set" login message. The
# original TLS setting is then restored so the security suite can log in.
#
# The stack uses container names and port 443, so nothing else may be running.

lux_upgrade_replay() {
  local env_file="${SECURITY_GATE_UPGRADE_ENV:-$LUX_ROOT/.env}"
  local branch prev scratch tls_line
  test -f "$env_file" || { echo "Upgrade replay needs an .env (SECURITY_GATE_UPGRADE_ENV or ./.env)" >&2; return 1; }
  if docker ps --format '{{.Names}}' | grep -qx 'ludus-ux'; then
    echo "A ludus-ux container is running. Stop it (docker compose down) before the upgrade replay." >&2
    return 1
  fi
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$branch" == "HEAD" ]] && { echo "Upgrade replay needs a branch checked out (upgrade.sh takes a remote ref)" >&2; return 1; }
  prev="$(git tag --merged HEAD --sort=-v:refname --list 'v[0-9]*' | grep -vx "v$(node -p 'require("./package.json").version')" | head -1)"
  [[ -n "$prev" ]] || { echo "No earlier release tag to upgrade from" >&2; return 1; }

  scratch="$(mktemp -d "${TMPDIR:-/tmp}/lux-upgrade-replay.XXXXXX")"
  LUX_REPLAY_DIR="$scratch"
  lux_gate_cleanup() {
    (cd "$LUX_REPLAY_DIR" && docker compose down -v --remove-orphans >/dev/null 2>&1) || true
    rm -rf "$LUX_REPLAY_DIR"
  }

  lux_step "upgrade replay: start $prev"
  git clone --quiet "$LUX_ROOT" "$scratch"
  git -C "$scratch" checkout --quiet "$prev"
  grep -v '^[[:space:]]*LUDUS_TLS_INSECURE=' "$env_file" > "$scratch/.env"
  tls_line="$(grep '^[[:space:]]*LUDUS_TLS_INSECURE=' "$env_file" | tail -1 || true)"
  local key_dir
  key_dir="$(grep -E '^[[:space:]]*SSH_KEY_PATH=' "$env_file" | tail -1 | cut -d= -f2- || true)"
  key_dir="${key_dir:-$LUX_ROOT/ssh}"
  [[ "$key_dir" = /* ]] || key_dir="$LUX_ROOT/$key_dir"
  if [[ -d "$key_dir" ]]; then
    mkdir -p "$scratch/ssh"
    cp -p "$key_dir"/* "$scratch/ssh/" 2>/dev/null || true
    sed -i '/^[[:space:]]*SSH_KEY_PATH=/d' "$scratch/.env"
  fi
  (cd "$scratch" && docker compose up -d --build)
  wait_healthy "https://localhost"

  lux_step "upgrade replay: $prev's upgrade.sh to $branch"
  (cd "$scratch" && LUX_UPGRADE_YES=1 bash scripts/upgrade.sh "$branch")
  wait_healthy "https://localhost"

  lux_step "upgrade replay: SSH key readable by the app user"
  docker exec ludus-ux sh -c '
    for k in /app/ssh/*; do
      [ -f "$k" ] || continue
      case "$(basename "$k")" in .*|*.pub|known_hosts*|authorized_keys*) continue ;; esac
      test -r "$k" || test -r "/run/lux-ssh/$(basename "$k")" || { echo "unreadable: $k" >&2; exit 1; }
    done'

  lux_step "upgrade replay: TLS message for an upgraded .env"
  local body
  body="$(node -e 'process.stdout.write(JSON.stringify({ username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASSWORD }))' \
    | curl -ksS -H 'Content-Type: application/json' --data @- https://localhost/api/auth/login || true)"
  if grep -qi 'certificate' <<<"$body"; then
    grep -q 'LUDUS_TLS_INSECURE is not set' <<<"$body" || {
      echo "Login hit a certificate error without naming the missing LUDUS_TLS_INSECURE" >&2
      return 1
    }
  else
    echo "Ludus certificate verified; the missing-key message only shows on a certificate error."
  fi

  if [[ -n "$tls_line" ]]; then
    lux_step "upgrade replay: restore $tls_line for the suite"
    printf '%s\n' "$tls_line" >> "$scratch/.env"
    (cd "$scratch" && docker compose up -d)
    wait_healthy "https://localhost"
  fi
}
