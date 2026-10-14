#!/usr/bin/env bash
# Remove lux-host from the Ludus host. Does not stop LUX or delete ./data, ./ssh, or .env.
#
#   bash scripts/uninstall.sh
#   bash scripts/uninstall.sh --yes
#   bash scripts/uninstall.sh --print
#
# --print writes a command to run in a root shell on the Ludus host and does not SSH.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
fi

lux_host_installed_files() {
  printf '%s\n' \
    /usr/local/sbin/lux-host \
    /etc/sudoers.d/lux-host \
    /etc/lux-host.update-key
}

# Delete the installed files under prefix. An empty prefix is the real host root.
lux_host_uninstall_apply() {
  local prefix="${1:-}"
  local rel
  while IFS= read -r rel; do
    rm -f "${prefix}${rel}"
  done < <(lux_host_installed_files)
}

lux_host_uninstall_remote_script() {
  cat <<'EOS'
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "lux-host uninstall must run as root" >&2
  exit 1
fi
rm -f \
  /usr/local/sbin/lux-host \
  /etc/sudoers.d/lux-host \
  /etc/lux-host.update-key
for f in /usr/local/sbin/lux-host /etc/sudoers.d/lux-host /etc/lux-host.update-key; do
  if [[ -e "$f" ]]; then
    echo "still present: $f" >&2
    exit 1
  fi
done
echo "Removed lux-host."
EOS
}

lux_uninstall_read_env() {
  local key="$1"
  python3 - "$key" <<'PY'
import re, sys
from pathlib import Path
name = sys.argv[1]
path = Path(".env")
if not path.is_file():
    sys.exit(0)
pat = re.compile(r"^\s*#?\s*" + re.escape(name) + r"=(.*)")
for line in path.read_text(encoding="utf-8").splitlines():
    match = pat.match(line)
    if match:
        value = match.group(1).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        print(value)
        sys.exit(0)
print("")
PY
}

lux_uninstall_usage() {
  cat <<'EOF'
Usage: bash scripts/uninstall.sh [--yes] [--print]

Remove lux-host from the Ludus host:
  /usr/local/sbin/lux-host
  /etc/sudoers.d/lux-host
  /etc/lux-host.update-key

SSH uses PROXMOX_SSH_USER from .env. Root deletes the files directly.
Any other account uses sudo. --print writes a root-shell command and does not SSH.
This does not stop LUX or delete ./data, ./ssh, or .env.
EOF
}

LUX_UNINSTALL_SSH_BASE=()
LUX_UNINSTALL_KEY=""
LUX_UNINSTALL_REMOTE=""

lux_uninstall_ssh() {
  local mode="$1"
  shift
  if [[ "$mode" == "key" ]]; then
    ssh "${LUX_UNINSTALL_SSH_BASE[@]}" -o BatchMode=yes -i "$LUX_UNINSTALL_KEY" "$LUX_UNINSTALL_REMOTE" "$@"
    return
  fi
  local pw
  pw="$(lux_uninstall_read_env PROXMOX_SSH_PASSWORD)"
  SSHPASS="$pw" sshpass -e ssh "${LUX_UNINSTALL_SSH_BASE[@]}" \
    -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    "$LUX_UNINSTALL_REMOTE" "$@"
}

lux_uninstall_main() {
  local assume_yes=0 print_only=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes|-y) assume_yes=1 ;;
      --print) print_only=1 ;;
      --help|-h)
        lux_uninstall_usage
        return 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        lux_uninstall_usage >&2
        return 1
        ;;
    esac
    shift
  done

  if [[ "$print_only" -eq 1 ]]; then
    lux_host_uninstall_remote_script
    return 0
  fi

  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$root"

  if [[ ! -f .env ]]; then
    echo "Error: .env not found. Run this from a configured LUX checkout." >&2
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required to read .env." >&2
    return 1
  fi

  local host port user key_dir
  host="$(lux_uninstall_read_env LUDUS_SSH_HOST)"
  host="${host//[[:space:]]/}"
  port="$(lux_uninstall_read_env LUDUS_SSH_PORT)"
  port="${port:-22}"
  user="$(lux_uninstall_read_env PROXMOX_SSH_USER)"
  user="${user:-root}"
  key_dir="$(lux_uninstall_read_env SSH_KEY_PATH)"
  key_dir="${key_dir:-./ssh}"
  if [[ "$key_dir" == "ssh" ]]; then
    key_dir="./ssh"
  fi
  if [[ "$key_dir" != /* ]]; then
    key_dir="${root}/${key_dir#./}"
  fi

  if [[ -z "$host" ]]; then
    echo "Error: LUDUS_SSH_HOST is empty in .env." >&2
    return 1
  fi
  if [[ ! "$host" =~ ^[A-Za-z0-9.:_-]+$ ]]; then
    echo "Error: LUDUS_SSH_HOST is not a hostname or address." >&2
    return 1
  fi
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    echo "Error: LUDUS_SSH_PORT must be a number." >&2
    return 1
  fi
  if [[ ! "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
    echo "Error: PROXMOX_SSH_USER must be a plain Linux username." >&2
    return 1
  fi

  echo "This removes lux-host from ${user}@${host}:"
  lux_host_installed_files | sed 's/^/  /'
  echo "LUX containers, ./data, ./ssh, and .env are left in place."
  if [[ "$assume_yes" -ne 1 ]]; then
    local answer
    read -r -p "Continue? [y/N] " answer
    if [[ ! "${answer,,}" =~ ^y ]]; then
      echo "Aborted."
      return 0
    fi
  fi

  LUX_UNINSTALL_SSH_BASE=(-o StrictHostKeyChecking=accept-new -p "$port")
  LUX_UNINSTALL_KEY="${key_dir}/id_rsa"
  LUX_UNINSTALL_REMOTE="${user}@${host}"
  local script
  script="$(lux_host_uninstall_remote_script)"

  local ssh_mode="none"
  if [[ -s "$key_dir/id_rsa" ]] && lux_uninstall_ssh key true; then
    ssh_mode="key"
  else
    local ssh_pw
    ssh_pw="$(lux_uninstall_read_env PROXMOX_SSH_PASSWORD)"
    if [[ -n "$ssh_pw" ]] && command -v sshpass >/dev/null 2>&1; then
      if lux_uninstall_ssh password true; then
        ssh_mode="password"
      fi
    fi
    unset ssh_pw
  fi
  if [[ "$ssh_mode" == "none" ]]; then
    echo "Cannot SSH as ${LUX_UNINSTALL_REMOTE}." >&2
    echo "Run this in a root shell on the Ludus host:" >&2
    echo "  bash scripts/uninstall.sh --print" >&2
    return 1
  fi

  if [[ "$user" == "root" ]]; then
    printf '%s\n' "$script" | lux_uninstall_ssh "$ssh_mode" bash -s
    return
  fi
  if lux_uninstall_ssh "$ssh_mode" sudo -n true; then
    printf '%s\n' "$script" | lux_uninstall_ssh "$ssh_mode" sudo -n bash -s
    return
  fi

  local sudo_pw=""
  read -r -s -p "sudo password for ${user} on ${host} (used once): " sudo_pw
  echo
  if [[ -z "$sudo_pw" ]]; then
    echo "No sudo password. Run this in a root shell on the Ludus host:" >&2
    echo "  bash scripts/uninstall.sh --print" >&2
    return 1
  fi
  if ! printf '%s\n%s\n' "$sudo_pw" "$script" | lux_uninstall_ssh "$ssh_mode" sudo -S -p '' bash -s; then
    unset sudo_pw
    echo "sudo failed. Run this in a root shell on the Ludus host:" >&2
    echo "  bash scripts/uninstall.sh --print" >&2
    return 1
  fi
  unset sudo_pw
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  lux_uninstall_main "$@"
fi
