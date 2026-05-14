#!/usr/bin/env bash
# LUX interactive setup — writes .env, SSH keys menu, Docker. From repo root:
#   bash scripts/quickstart.sh
#   bash scripts/quickstart.sh --full    # wizard only (no top prompt)
#   bash scripts/quickstart.sh --menu    # submenu only (needs .env)

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f docker-compose.yml ]]; then
  echo "Error: docker-compose.yml not found. Run this script from the ludus-ux repo root." >&2
  exit 1
fi

if [[ ! -f .env.example ]]; then
  echo "Error: .env.example not found in $ROOT" >&2
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is required (used to write .env safely)." >&2
  exit 1
fi

# Compose: Docker Compose V2 plugin (docker compose) or legacy standalone (docker-compose).
lux_compose() {
  if docker compose version &>/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null && docker-compose version &>/dev/null 2>&1; then
    docker-compose "$@"
  else
    return 127
  fi
}

# Needed for full wizard and for the "Docker compose up" action only (individual actions skip this until selected).
lux_require_compose_tools() {
  # Docker CLI (Linux Engine or Windows/macOS Docker Desktop). Git Bash on Windows needs a new shell after install so PATH includes Docker.
  if ! command -v docker &>/dev/null; then
    echo "Error: docker was not found in PATH." >&2
    echo "" >&2
    echo "  Linux: install Docker Engine — https://docs.docker.com/engine/install/" >&2
    echo "         Add your user to the docker group if the daemon is permission-denied (then re-login)." >&2
    echo "" >&2
    echo "  Windows: install Docker Desktop — https://docs.docker.com/desktop/setup/install/windows-install/" >&2
    echo "           Start Docker Desktop, then open a new Git Bash or terminal so docker.exe is on PATH." >&2
    return 1
  fi

  if ! lux_compose version &>/dev/null; then
    echo "Error: Docker Compose is not available (tried 'docker compose' and 'docker-compose')." >&2
    echo "" >&2
    echo "  Linux: use the Compose V2 plugin with Docker Engine (often docker-compose-plugin package)," >&2
    echo "         or install standalone docker-compose and ensure it is on PATH." >&2
    echo "" >&2
    echo "  Windows: in Docker Desktop → Settings → General, enable \"Use Docker Compose V2\"." >&2
    echo "            Restart Docker Desktop; use a new shell and run: docker compose version" >&2
    return 1
  fi

  return 0
}

lux_usage() {
  cat <<USAGE
Usage: bash scripts/quickstart.sh [OPTIONS]

  (no options) Prompt: full setup vs individual actions
  --full, -f   Full interactive wizard (creates/overwrites .env, keys, GOAD, optional compose up)
  --menu, -m   Individual actions submenu (needs an existing .env)
  --help, -h   This help

Examples:
  bash scripts/quickstart.sh
  bash scripts/quickstart.sh --menu
USAGE
}

lux_print_banner() {
  echo "=== Ludus UX (LUX) quick start ==="
  echo ""
}

# Set KEY=VALUE in .env (replaces commented or uncommented lines for that key).
set_kv() {
  export _LUX_K="$1" _LUX_V="$2"
  python3 - <<'PY'
import os, re
from pathlib import Path
key, val = os.environ["_LUX_K"], os.environ["_LUX_V"]
path = Path(".env")
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
out = []
seen = False
pat = re.compile(r"^\s*#?\s*" + re.escape(key) + r"=")
for line in lines:
    if pat.match(line):
        out.append(f"{key}={val}\n")
        seen = True
    else:
        out.append(line)
if not seen:
    if out and not out[-1].endswith("\n"):
        out[-1] = out[-1] + "\n"
    out.append(f"{key}={val}\n")
path.write_text("".join(out), encoding="utf-8")
PY
  unset _LUX_K _LUX_V
}

# Read KEY from .env in cwd (handles "# KEY=value" commented lines matching set_kv).
lux_read_env_kv() {
  local k="$1"
  python3 -c "
import re, sys
from pathlib import Path
key = sys.argv[1]
path = Path('.env')
if not path.is_file():
    sys.exit(0)
pat = re.compile(r'^\s*#?\s*' + re.escape(key) + r'=(.*)')
for line in path.read_text(encoding='utf-8').splitlines():
    m = pat.match(line)
    if m:
        v = m.group(1).strip().strip('\"').strip(\"'\")
        print(v)
        sys.exit(0)
print('')
" "$k"
}

lux_require_env_for_actions() {
  if [[ ! -f .env ]]; then
    echo "Error: .env not found. Run full setup first:" >&2
    echo "  bash scripts/quickstart.sh --full" >&2
    return 1
  fi
}

lux_resolve_ssh_key_dir_from_env() {
  local skp
  skp="$(lux_read_env_kv SSH_KEY_PATH)"
  skp="${skp:-./ssh}"
  if [[ "$skp" == "ssh" ]]; then
    skp="./ssh"
  fi
  if [[ "$skp" == /* ]]; then
    KEY_DIR="$skp"
  else
    KEY_DIR="$ROOT/${skp#./}"
  fi
}

# Sets LUDUS_SSH_HOST, LUDUS_SSH_PORT (default 22), KEY_DIR from .env — use before remote SSH helpers.
lux_load_ludus_ssh_from_env() {
  lux_require_env_for_actions || return 1
  LUDUS_SSH_HOST="$(lux_read_env_kv LUDUS_SSH_HOST)"
  LUDUS_SSH_HOST="${LUDUS_SSH_HOST//[[:space:]]/}"
  LUDUS_SSH_PORT="$(lux_read_env_kv LUDUS_SSH_PORT)"
  LUDUS_SSH_PORT="${LUDUS_SSH_PORT:-22}"
  lux_resolve_ssh_key_dir_from_env
  if [[ -z "$LUDUS_SSH_HOST" ]]; then
    echo "Error: LUDUS_SSH_HOST is empty or missing in .env." >&2
    return 1
  fi
}

# Ensure sshpass exists locally (interactive install). LUX_QS_SSHPASS_STRICT=1: exit script if still missing after decline/install failure.
lux_ensure_sshpass_local_available() {
  local strict="${LUX_QS_SSHPASS_STRICT:-0}"
  if command -v sshpass &>/dev/null; then
    return 0
  fi
  echo "" >&2
  echo "sshpass is not installed. It is needed for scripted SSH using a password (non-interactively)." >&2
  read -r -p "Install sshpass now (uses apt/dnf/yum/brew/pacman if found)? [Y/n] " _ins_sshpass
  _ins_sshpass="${_ins_sshpass:-y}"
  local _lc
  _lc=$(printf '%s' "$_ins_sshpass" | tr '[:upper:]' '[:lower:]')
  if [[ "$_lc" != y* ]]; then
    echo "Skipped sshpass install." >&2
    if [[ "$strict" == "1" ]]; then
      echo "Cannot continue this step without sshpass. Use option 1 as root, option 2 (local key), or install sshpass and re-run." >&2
      exit 1
    fi
    return 1
  fi
  echo "Attempting to install sshpass…"
  set +e
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y sshpass
  elif command -v apt &>/dev/null; then
    sudo apt update -qq && sudo apt install -y sshpass
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y sshpass
  elif command -v yum &>/dev/null; then
    sudo yum install -y sshpass
  elif command -v brew &>/dev/null; then
    brew install sshpass
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm sshpass 2>/dev/null || pacman -S --noconfirm sshpass
  else
    echo "No supported package manager found in PATH." >&2
  fi
  set -e

  if command -v sshpass &>/dev/null; then
    echo "sshpass is available."
    return 0
  fi

  echo "" >&2
  echo "sshpass is still missing. Install it manually, then re-run this script:" >&2
  echo "  Debian/Ubuntu: sudo apt install sshpass" >&2
  echo "  Fedora/RHEL:   sudo dnf install sshpass" >&2
  echo "  macOS:         brew install sshpass" >&2
  echo "  Windows:       WSL: sudo apt install sshpass — or MSYS2: pacman -S sshpass" >&2
  echo "Or use quickstart option 1 as root, option 2 with a local key file." >&2
  if [[ "$strict" == "1" ]]; then
    exit 1
  fi
  return 1
}

# Reuse across menu actions: .env PROXMOX_SSH_PASSWORD if set, else prompt once (not written to .env).
lux_acquire_session_ludus_ssh_password() {
  lux_require_env_for_actions || return 1
  if [[ -n "${LUX_SESSION_LUDUS_SSH_PW:-}" ]]; then
    return 0
  fi
  local pw ux hx
  pw="$(lux_read_env_kv PROXMOX_SSH_PASSWORD)"
  if [[ -n "$pw" ]]; then
    LUX_SESSION_LUDUS_SSH_PW="$pw"
    return 0
  fi
  ux="$(lux_read_env_kv PROXMOX_SSH_USER)"
  ux="${ux:-root}"
  hx="$(lux_read_env_kv LUDUS_SSH_HOST)"
  hx="${hx//[[:space:]]/}"
  echo "No PROXMOX_SSH_PASSWORD in .env — enter SSH password once (kept in memory for this script run only)." >&2
  if [[ -r /dev/tty ]]; then
    read -r -s -p "SSH password for ${ux}@${hx}: " pw </dev/tty
    echo >/dev/tty || true
  else
    read -r -s -p "SSH password for ${ux}@${hx}: " pw
    echo >&2
  fi
  if [[ -z "$pw" ]]; then
    echo "Error: empty password." >&2
    return 1
  fi
  LUX_SESSION_LUDUS_SSH_PW="$pw"
}

# Feed bash -s on stdin to user@host on Ludus (password via sshpass only; no key probe).
lux_ludus_ssh_remote_bash_sshpass() {
  local uh="$1"
  lux_load_ludus_ssh_from_env || return 1
  lux_ensure_sshpass_local_available || return 1
  lux_acquire_session_ludus_ssh_password || return 1
  local script
  script="$(cat)"
  local -a BASE=( -o StrictHostKeyChecking=accept-new -p "$LUDUS_SSH_PORT" )
  printf '%s\n' "$script" | SSHPASS="$LUX_SESSION_LUDUS_SSH_PW" sshpass -e ssh "${BASE[@]}" -o PreferredAuthentications=password -o PubkeyAuthentication=no "$uh" 'bash -s'
}

lux_ensure_remote_sudo_for_goad() {
  local uh

  lux_load_ludus_ssh_from_env || return 1

  uh="$(lux_read_env_kv PROXMOX_SSH_USER)"
  uh="${uh:-root}"
  uh="${uh}@${LUDUS_SSH_HOST}"

  echo "Checking ${uh} for 'sudo' (GOAD runs commands with sudo)…"
  local check_script install_script
  check_script="$(cat <<'EOS'
set -euo pipefail
command -v sudo >/dev/null 2>&1
EOS
)"

  install_script="$(cat <<'EOS'
set -euo pipefail
if command -v sudo >/dev/null 2>&1; then
  exit 0
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "[quickstart] Remote SSH user is non-root — install sudo on the Ludus host yourself if GOAD fails." >&2
  exit 0
fi
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y sudo
elif command -v apt >/dev/null 2>&1; then
  apt update -qq && apt install -y sudo
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y sudo
elif command -v yum >/dev/null 2>&1; then
  yum install -y sudo
else
  echo "[quickstart] No apt/apt-get/dnf/yum on remote — install sudo manually if you use GOAD." >&2
  exit 1
fi
EOS
)"

  printf '%s\n' "$check_script" | lux_ludus_ssh_remote_bash_sshpass "$uh" && {
    echo "sudo is available on Ludus SSH host."
    return 0
  }

  echo "Installing sudo on Ludus SSH host…"
  if printf '%s\n' "$install_script" | lux_ludus_ssh_remote_bash_sshpass "$uh"; then
    printf '%s\n' "$check_script" | lux_ludus_ssh_remote_bash_sshpass "$uh" && echo "sudo installed and verified." && return 0
    echo "[quickstart] sudo install ran but verification failed — check SSH and APT on the Ludus host." >&2
    return 1
  fi
  echo "[quickstart] Password SSH failed (wrong password, host down, or sshd policy). Fix PROXMOX_SSH_PASSWORD / network and retry." >&2
  return 1
}

# One-line base64 pubkey for lux_ssh_remote_authorized_keys_body. stderr on failure.
# Unreadable keys (wrong owner after scp, mode 600) → try ssh-keygen, then sudo ssh-keygen.
lux_openssh_pubkey_b64_from_private() {
  local key_file="$1"
  local pub_tmp b64

  if ! command -v ssh-keygen &>/dev/null; then
    echo "ssh-keygen not found; cannot derive public key." >&2
    return 1
  fi

  pub_tmp=$(mktemp)
  if ssh-keygen -y -f "$key_file" >"$pub_tmp" 2>/dev/null; then
    :
  else
    rm -f "$pub_tmp"
    pub_tmp=$(mktemp)
    if command -v sudo &>/dev/null && sudo ssh-keygen -y -f "$key_file" >"$pub_tmp" 2>/dev/null; then
      if [[ ! -r "$key_file" ]]; then
        echo "[quickstart] Used sudo ssh-keygen (your user couldn't read $key_file). Persist for Docker:" >&2
        echo "  sudo chown $(id -un):$(id -gn) -- \"$key_file\" && chmod 600 -- \"$key_file\"" >&2
      fi
    else
      rm -f "$pub_tmp"
      echo "Could not derive pubkey from $key_file." >&2
      if [[ ! -r "$key_file" ]]; then
        echo "Other-uid + mode 600 is common after copying from Ludus." >&2
        echo "  sudo chown $(id -un):$(id -gn) -- \"$key_file\" && chmod 600 -- \"$key_file\"" >&2
      else
        echo "If passphrase-protected, set PROXMOX_SSH_KEY_PASSPHRASE (.env.example / docs/environment.md)." >&2
      fi
      return 1
    fi
  fi

  export _LUX_PUB_TMP="$pub_tmp"
  b64=$(python3 -c "import base64, os; print(base64.b64encode(open(os.environ['_LUX_PUB_TMP'], 'rb').read()).decode())")
  unset _LUX_PUB_TMP
  rm -f "$pub_tmp"
  printf '%s\n' "$b64"
}

# Ensure sshd will accept this private key: append derived pubkey to REMOTE_USER's authorized_keys (root only).
# Tries BatchMode + -i key first; if that fails, optional one-shot SSH password + sshpass.
lux_ssh_remote_authorized_keys_body() {
  local b64="$1"
  cat <<REMOTE
set -euo pipefail
PUB=\$(printf '%s' '$b64' | base64 -d | tr -d '\r')
mkdir -p "\$HOME/.ssh"
chmod 700 "\$HOME/.ssh"
touch "\$HOME/.ssh/authorized_keys"
chmod 600 "\$HOME/.ssh/authorized_keys"
grep -qxF "\$PUB" "\$HOME/.ssh/authorized_keys" || printf '%s\n' "\$PUB" >> "\$HOME/.ssh/authorized_keys"
REMOTE
}

lux_ssh_append_pubkey_remote() {
  local b64="$1"
  shift
  lux_ssh_remote_authorized_keys_body "$b64" | ssh "$@" 'bash -s'
}

lux_install_pubkey_for_root_ssh() {
  local key_file="$1" host="$2" port="$3" remote_user="${4:-root}"
  local -a BASE=( -o StrictHostKeyChecking=accept-new -p "$port" )

  if [[ "$remote_user" != "root" ]]; then
    echo "Skipping authorized_keys auto-setup (only implemented for PROXMOX_SSH_USER=root). See docs/ssh-and-auth.md."
    return 0
  fi

  local b64
  if ! b64="$(lux_openssh_pubkey_b64_from_private "$key_file")"; then
    return 0
  fi

  echo "Ensuring ${remote_user}@${host} accepts this key (authorized_keys)…"

  if lux_ssh_append_pubkey_remote "$b64" "${BASE[@]}" -o BatchMode=yes -i "$key_file" "${remote_user}@${host}"; then
    echo "authorized_keys OK — key login should work for LUX."
    return 0
  fi

  echo "Pubkey not authorized yet (or passphrase required). One-shot SSH password can append the pubkey."

  local LUX_AK_PW=""
  read -r -s -p "SSH password for ${remote_user}@${host} (Enter to skip manual step): " LUX_AK_PW
  echo
  if [[ -z "$LUX_AK_PW" ]]; then
    echo "Skipped. Append pubkey manually — docs/ssh-and-auth.md."
    unset LUX_AK_PW
    return 0
  fi

  if ! lux_ensure_sshpass_local_available; then
    unset LUX_AK_PW
    return 0
  fi
  if lux_ssh_remote_authorized_keys_body "$b64" | SSHPASS="$LUX_AK_PW" sshpass -e ssh "${BASE[@]}" -o PreferredAuthentications=password -o PubkeyAuthentication=no "${remote_user}@${host}" 'bash -s'; then
    unset LUX_AK_PW
    if lux_ssh_append_pubkey_remote "$b64" "${BASE[@]}" -o BatchMode=yes -i "$key_file" "${remote_user}@${host}"; then
      echo "authorized_keys updated — verified key login."
    else
      echo "Pubkey appended but key login still fails (passphrase, PermitRootLogin, or wrong key); check docs/ssh-and-auth.md."
    fi
    return 0
  fi

  unset LUX_AK_PW
  echo "Password SSH failed; authorized_keys unchanged. See docs/ssh-and-auth.md." >&2
  return 0
}

lux_action_pubkey_from_env() {
  lux_load_ludus_ssh_from_env || return 1
  local px_user kf uh b64
  px_user="$(lux_read_env_kv PROXMOX_SSH_USER)"
  px_user="${px_user:-root}"
  uh="${px_user}@${LUDUS_SSH_HOST}"
  kf="$KEY_DIR/id_rsa"
  if [[ ! -f "$kf" ]]; then
    echo "Error: no private key at $kf — run full setup (option 1/2) or place id_rsa there." >&2
    return 1
  fi
  mkdir -p "$KEY_DIR" 2>/dev/null || true
  if ! b64="$(lux_openssh_pubkey_b64_from_private "$kf")"; then
    return 1
  fi
  echo "Appending pubkey from $kf to ~/.ssh/authorized_keys on ${uh} (PROXMOX SSH password only; reuses earlier prompt / .env)…"
  if lux_ssh_remote_authorized_keys_body "$b64" | lux_ludus_ssh_remote_bash_sshpass "$uh"; then
    echo "authorized_keys updated for ${uh}."
    return 0
  fi
  echo "[quickstart] authorized_keys append failed — check password, sshd AllowUsers, PROXMOX_SSH_USER match." >&2
  return 1
}

lux_action_docker_up_build() {
  if ! lux_require_compose_tools; then
    return 1
  fi
  lux_compose up -d --build
  echo ""
  echo "Compose stack updated."
}

lux_action_print_ssh_env_hints() {
  lux_require_env_for_actions || return 1
  lux_resolve_ssh_key_dir_from_env
  local pw ip
  echo ""
  echo "Useful entries from .env:"
  printf '  %-26s %s\n' LUDUS_SSH_HOST "$(lux_read_env_kv LUDUS_SSH_HOST)"
  printf '  %-26s %s\n' LUDUS_SSH_PORT "$(lux_read_env_kv LUDUS_SSH_PORT)"
  ip="$(lux_read_env_kv LUDUS_SERVER_IP)"
  [[ -n "$ip" ]] && printf '  %-26s %s\n' LUDUS_SERVER_IP "$ip"
  printf '  %-26s %s\n' SSH_KEY_PATH "$(lux_read_env_kv SSH_KEY_PATH)"
  printf '  %-26s %s\n' "resolved KEY_DIR" "$KEY_DIR"
  if [[ -f "$KEY_DIR/id_rsa" ]]; then
    printf '  %-26s %s\n' "SSH private key" "${KEY_DIR}/id_rsa (present)"
  else
    printf '  %-26s %s\n' "SSH private key" "${KEY_DIR}/id_rsa (missing)"
  fi
  printf '  %-26s %s\n' PROXMOX_SSH_USER "$(lux_read_env_kv PROXMOX_SSH_USER)"
  pw="$(lux_read_env_kv PROXMOX_SSH_PASSWORD)"
  if [[ -n "$pw" ]]; then
    printf '  %-26s %s\n' PROXMOX_SSH_PASSWORD "(set, hidden)"
  else
    printf '  %-26s %s\n' PROXMOX_SSH_PASSWORD "(empty)"
  fi
  printf '  %-26s %s\n' GOAD_PATH "$(lux_read_env_kv GOAD_PATH)"
  printf '  %-26s %s\n' ENABLE_GOAD "$(lux_read_env_kv ENABLE_GOAD)"
  echo ""
}

lux_run_action_menu() {
  while true; do
    echo ""
    echo "Individual actions (reuse ./.env in this repo):"
    echo "  1) Ensure 'sudo' on Ludus SSH host (required for GOAD automation)"
    echo "  2) Append SSH_KEY_PATH/id_rsa pubkey → authorized_keys (sshpass; chown key if unreadable)"
    echo "  3) docker compose up -d --build (needs Docker available here)"
    echo "  4) Print Ludus / SSH / GOAD fields from .env (mask password)"
    echo "  0) Exit menu"
    read -r -p "Choose [0-4] [0]: " _ac
    _ac="${_ac:-0}"
    case "$_ac" in
      1)
        lux_ensure_remote_sudo_for_goad || true
        ;;
      2)
        lux_action_pubkey_from_env || true
        ;;
      3)
        lux_action_docker_up_build || true
        ;;
      4)
        lux_action_print_ssh_env_hints || true
        ;;
      0)
        echo "Bye."
        return 0
        ;;
      *)
        echo "Invalid choice." >&2
        ;;
    esac
  done
}

lux_run_full_wizard() {

if ! lux_require_compose_tools; then exit 1; fi

echo "=== Full interactive setup ==="
echo ""

if [[ -f .env ]]; then
  read -r -p ".env already exists. Overwrite? [y/N] " ow
  if [[ ! "${ow,,}" =~ ^y ]]; then
    echo "Aborted."
    exit 0
  fi
fi

cp .env.example .env
echo "Created .env from .env.example"

read -r -p "Ludus server hostname or IP (LUDUS_SSH_HOST) [required]: " LUDUS_SSH_HOST
LUDUS_SSH_HOST="${LUDUS_SSH_HOST//[[:space:]]/}"
if [[ -z "$LUDUS_SSH_HOST" ]]; then
  echo "Error: LUDUS_SSH_HOST is required." >&2
  exit 1
fi
set_kv "LUDUS_SSH_HOST" "$LUDUS_SSH_HOST"

read -r -p "SSH port [22]: " LUDUS_SSH_PORT
LUDUS_SSH_PORT="${LUDUS_SSH_PORT:-22}"
set_kv "LUDUS_SSH_PORT" "$LUDUS_SSH_PORT"

read -r -p "LUDUS_SERVER_IP (if Docker cannot resolve the hostname; optional, Enter to skip): " LUDUS_SERVER_IP
LUDUS_SERVER_IP="${LUDUS_SERVER_IP//[[:space:]]/}"
if [[ -n "$LUDUS_SERVER_IP" ]]; then
  set_kv "LUDUS_SERVER_IP" "$LUDUS_SERVER_IP"
fi

read -r -p "Generate APP_SECRET with openssl? [Y/n] " gen_sec
gen_sec="${gen_sec:-y}"
if [[ "${gen_sec,,}" =~ ^y ]]; then
  if ! command -v openssl &>/dev/null; then
    echo "openssl not found; enter APP_SECRET manually."
    read -r -s -p "APP_SECRET: " APP_SECRET
    echo
  else
    APP_SECRET="$(openssl rand -hex 32)"
    echo "Generated APP_SECRET ($((${#APP_SECRET} / 2)) bytes hex)."
  fi
else
  read -r -s -p "APP_SECRET: " APP_SECRET
  echo
fi
if [[ -z "$APP_SECRET" ]]; then
  echo "Error: APP_SECRET is required." >&2
  exit 1
fi
set_kv "APP_SECRET" "$APP_SECRET"

read -r -p "LUDUS_ROOT_API_KEY (from /opt/ludus/install/root-api-key; Enter to skip — admin features need it): " LUDUS_ROOT_API_KEY
set_kv "LUDUS_ROOT_API_KEY" "${LUDUS_ROOT_API_KEY:-}"

read -r -p "Host directory for root SSH private key (SSH_KEY_PATH) [./ssh]: " skp_in
skp_in="${skp_in:-./ssh}"
if [[ "$skp_in" == "ssh" ]]; then
  skp_in="./ssh"
fi
set_kv "SSH_KEY_PATH" "$skp_in"

# Resolve directory on host (relative to repo root)
if [[ "$skp_in" == /* ]]; then
  KEY_DIR="$skp_in"
else
  KEY_DIR="$ROOT/${skp_in#./}"
fi
mkdir -p "$KEY_DIR"
chmod 755 "$KEY_DIR" 2>/dev/null || true

echo ""
echo "Root SSH to the Ludus/Proxmox host (for pvesh, admin tunnel, etc.):"
echo "  1) Fetch private key from the server (scp as root; non-root + /root/ uses sshpass + sudo -S when needed — install sshpass if prompted)"
echo "  2) Copy from a file already on this machine"
echo "  3) Use password only (PROXMOX_SSH_PASSWORD)"
read -r -p "Choose [1/2/3]: " auth_choice
root_ssh_key_auth=0

case "${auth_choice:-1}" in
  1)
    read -r -p "SSH user on Ludus host to connect as [root]: " scp_user
    scp_user="${scp_user:-root}"
    read -r -p "Remote private key path [/root/.ssh/id_rsa]: " remote_key
    remote_key="${remote_key:-/root/.ssh/id_rsa}"
    SSH_BASE=( -o StrictHostKeyChecking=accept-new -p "$LUDUS_SSH_PORT" )
    remote_q=$(printf '%q' "$remote_key")
    if [[ "$scp_user" == "root" ]]; then
      echo "Running: scp -P $LUDUS_SSH_PORT ${scp_user}@${LUDUS_SSH_HOST}:${remote_key} -> $KEY_DIR/id_rsa"
      if ! scp -o StrictHostKeyChecking=accept-new -P "$LUDUS_SSH_PORT" \
          "${scp_user}@${LUDUS_SSH_HOST}:${remote_key}" "$KEY_DIR/id_rsa"; then
        echo "scp failed. Place id_rsa manually under $KEY_DIR and run: docker compose up -d --build (or docker-compose)" >&2
        exit 1
      fi
    elif [[ "$remote_key" == /root/* ]]; then
      # Non-root cannot read /root over scp. Automate without PTY+redirect (which breaks sudo prompts):
      #   1) SSH key + sudo -n
      #   2) sshpass + sudo -n (password SSH only; sudo NOPASSWD)
      #   3) sshpass + sudo -S (password SSH + sudo via stdin — no ssh -t > file)
      SSH_BATCH=( "${SSH_BASE[@]}" -o BatchMode=yes )
      # Force password auth when using sshpass (avoid trying SSH keys first and burning retries).
      SSH_PASS_ONLY=( "${SSH_BASE[@]}" -o PreferredAuthentications=password -o PubkeyAuthentication=no )
      key_ok() { [[ -s "$KEY_DIR/id_rsa" ]] && grep -qE 'BEGIN.*PRIVATE KEY' "$KEY_DIR/id_rsa"; }

      rm -f "$KEY_DIR/id_rsa"
      echo "Non-root cannot scp under /root/. Trying automated fetch…"
      fetched=""

      if ssh "${SSH_BATCH[@]}" "${scp_user}@${LUDUS_SSH_HOST}" "sudo -n cat -- $remote_q" >"$KEY_DIR/id_rsa" 2>/dev/null && key_ok; then
        echo "OK — SSH key auth + passwordless sudo (NOPASSWD)."
        fetched=1
      else
        rm -f "$KEY_DIR/id_rsa"
        LUX_QS_SSHPASS_STRICT=1 lux_ensure_sshpass_local_available

        read -r -s -p "SSH password for ${scp_user}@${LUDUS_SSH_HOST}: " LUX_SSH_PW
        echo
        if [[ -z "$LUX_SSH_PW" ]]; then
          echo "Error: empty SSH password." >&2
          exit 1
        fi

        errf=$(mktemp)
        if printf '\n' | SSHPASS="$LUX_SSH_PW" sshpass -e ssh "${SSH_PASS_ONLY[@]}" "${scp_user}@${LUDUS_SSH_HOST}" \
            "sudo -n cat -- $remote_q" >"$KEY_DIR/id_rsa" 2>"$errf" && key_ok; then
          echo "OK — password SSH + passwordless sudo (NOPASSWD)."
          fetched=1
        else
          rm -f "$KEY_DIR/id_rsa"
          read -r -s -p "sudo password on server [Enter if same as SSH]: " LUX_SUDO_PW
          echo
          LUX_SUDO_PW="${LUX_SUDO_PW:-$LUX_SSH_PW}"
          if printf '%s\n' "$LUX_SUDO_PW" | SSHPASS="$LUX_SSH_PW" sshpass -e ssh "${SSH_PASS_ONLY[@]}" "${scp_user}@${LUDUS_SSH_HOST}" \
              "sudo -S cat -- $remote_q" >"$KEY_DIR/id_rsa" 2>"$errf" && key_ok; then
            echo "OK — password SSH + sudo -S (non-interactive)."
            fetched=1
          else
            echo "Automated fetch failed. Remote said:" >&2
            cat "$errf" >&2
            rm -f "$errf"
            unset LUX_SSH_PW LUX_SUDO_PW
            echo "Check SSH/sudo passwords and that $remote_key exists. Or use option 1 as root / option 2." >&2
            exit 1
          fi
        fi
        rm -f "$errf"
        unset LUX_SSH_PW LUX_SUDO_PW
      fi

      if [[ -z "$fetched" ]]; then
        echo "Internal error: fetch flag not set." >&2
        exit 1
      fi
    else
      echo "Running: scp -P $LUDUS_SSH_PORT ${scp_user}@${LUDUS_SSH_HOST}:${remote_key} -> $KEY_DIR/id_rsa"
      if ! scp -o StrictHostKeyChecking=accept-new -P "$LUDUS_SSH_PORT" \
          "${scp_user}@${LUDUS_SSH_HOST}:${remote_key}" "$KEY_DIR/id_rsa"; then
        echo "scp failed. Place id_rsa manually under $KEY_DIR and run: docker compose up -d --build (or docker-compose)" >&2
        exit 1
      fi
    fi
    chmod 600 "$KEY_DIR/id_rsa"
    lux_install_pubkey_for_root_ssh "$KEY_DIR/id_rsa" "$LUDUS_SSH_HOST" "$LUDUS_SSH_PORT" root
    # LUX uses this key to SSH as root on the Ludus/Proxmox host (fetch user above is only for copying the file).
    set_kv "PROXMOX_SSH_USER" "root"
    set_kv "PROXMOX_SSH_PASSWORD" ""
    set_kv "PROXMOX_SSH_KEY_PATH" "/app/ssh/id_rsa"
    root_ssh_key_auth=1
    ;;
  2)
    read -r -p "Path to existing private key file: " key_path
    key_path="${key_path/#\~/$HOME}"
    if [[ ! -f "$key_path" ]]; then
      echo "Error: file not found: $key_path" >&2
      exit 1
    fi
    cp "$key_path" "$KEY_DIR/id_rsa"
    chmod 600 "$KEY_DIR/id_rsa"
    read -r -p "PROXMOX_SSH_USER [root]: " px_user
    px_user="${px_user:-root}"
    lux_install_pubkey_for_root_ssh "$KEY_DIR/id_rsa" "$LUDUS_SSH_HOST" "$LUDUS_SSH_PORT" "$px_user"
    set_kv "PROXMOX_SSH_USER" "$px_user"
    set_kv "PROXMOX_SSH_PASSWORD" ""
    set_kv "PROXMOX_SSH_KEY_PATH" "/app/ssh/id_rsa"
    root_ssh_key_auth=1
    ;;
  3)
    read -r -s -p "PROXMOX_SSH_PASSWORD: " px_pw
    echo
    read -r -p "PROXMOX_SSH_USER [root]: " px_user
    set_kv "PROXMOX_SSH_USER" "${px_user:-root}"
    set_kv "PROXMOX_SSH_PASSWORD" "$px_pw"
    ;;
  *)
    echo "Invalid choice." >&2
    exit 1
    ;;
esac

if [[ "$root_ssh_key_auth" == "1" ]]; then
  echo ""
  echo "Optional: root PROXMOX_SSH_PASSWORD for server-side root SSH only."
  echo "In-browser noVNC now uses the LUX user's login password with their Proxmox PAM user; the root SSH key is not used for that HTTP ticket."
  read -r -s -p "Root PROXMOX_SSH_PASSWORD [Enter to keep key-only root SSH]: " optional_root_pw
  echo
  if [[ -n "$optional_root_pw" ]]; then
    set_kv "PROXMOX_SSH_PASSWORD" "$optional_root_pw"
  fi
  unset optional_root_pw
fi

read -r -p "GOAD path on Ludus server [/opt/GOAD]: " goad_path
goad_path="${goad_path:-/opt/GOAD}"
set_kv "GOAD_PATH" "$goad_path"

read -r -p "Show GOAD in the UI (ENABLE_GOAD)? [Y/n] " eg
eg="${eg:-y}"
if [[ "${eg,,}" =~ ^n ]]; then
  set_kv "ENABLE_GOAD" "false"
else
  set_kv "ENABLE_GOAD" "true"
fi

if [[ ! "${eg,,}" =~ ^n ]]; then
  echo ""
  lux_ensure_remote_sudo_for_goad || true
fi

echo ""
read -r -p "Run 'docker compose up -d --build' now? [Y/n] " do_up
do_up="${do_up:-y}"
if [[ "${do_up,,}" =~ ^y ]]; then
  lux_compose up -d --build
  echo ""
  echo "Stack started."
else
  echo "Skipped. When ready: docker compose up -d --build (or: docker-compose up -d --build)"
fi

echo ""
echo "=== Next steps ==="
echo "  • HTTPS UI: https://localhost (port 443 via bundled nginx) — self-signed warning unless you add docker/nginx/certificates/cert.pem + key.pem before first start"
echo "  • Optional: docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d exposes http://127.0.0.1:3000 to the app directly (bypass nginx)"
echo "  • Log in with a Ludus (non-root) SSH/PAM user. In-browser noVNC uses that session password for the user's Proxmox ticket."
echo "  • On the Ludus server: put LUDUS_API_KEY in ~/.bashrc for that user (and root) if needed — see docs/getting-started.md."
echo "  • In LUX: Settings → Test root SSH & admin API"
echo ""
echo "Done."
}


lux_main() {
  lux_print_banner
  local mode=""
  case "${1:-}" in
    --full | -f)
      mode="full"
      ;;
    --menu | -m)
      mode="menu"
      ;;
    --help | -h)
      lux_usage
      exit 0
      ;;
  esac

  if [[ -z "$mode" ]]; then
    echo "Pick a mode:"
    echo "  1) Full interactive setup (needs Docker locally — writes .env)"
    echo "  2) Individual actions only (reuse .env; Docker only if you run compose)"
    read -r -p "Choose [1/2] [1]: " _top
    _top="${_top:-1}"
    case "$_top" in
      1)
        mode="full"
        ;;
      2)
        mode="menu"
        ;;
      *)
        echo "Invalid choice." >&2
        exit 1
        ;;
    esac
  fi

  if [[ "$mode" == "menu" ]]; then
    lux_run_action_menu
  else
    lux_run_full_wizard
  fi
}

lux_main "$@"