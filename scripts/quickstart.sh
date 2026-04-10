#!/usr/bin/env bash
# LUX (ludus-ux) interactive setup — creates .env, prepares the SSH key directory, optional scp, starts Docker.
# Run from the repository root:
#   bash scripts/quickstart.sh
#   chmod +x scripts/quickstart.sh && ./scripts/quickstart.sh

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

echo "=== Ludus UX (LUX) quick start ==="
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
        echo "scp failed. Place id_rsa manually under $KEY_DIR and run: docker compose up -d --build" >&2
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
        if ! command -v sshpass &>/dev/null; then
          echo "" >&2
          echo "sshpass is not installed. It is required to fetch a root-only key over SSH using a password (plain ssh cannot do that non-interactively)." >&2
          read -r -p "Install sshpass now (uses apt/dnf/yum/brew/pacman if found)? [Y/n] " _ins_sshpass
          _ins_sshpass="${_ins_sshpass:-y}"
          _ins_lc=$(printf '%s' "$_ins_sshpass" | tr '[:upper:]' '[:lower:]')
          if [[ "$_ins_lc" == y* ]]; then
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
            if ! command -v sshpass &>/dev/null; then
              echo "" >&2
              echo "sshpass is still missing. Install it manually, then re-run this script:" >&2
              echo "  Debian/Ubuntu: sudo apt install sshpass" >&2
              echo "  Fedora/RHEL:   sudo dnf install sshpass" >&2
              echo "  macOS:         brew install sshpass" >&2
              echo "  Windows:       WSL: sudo apt install sshpass — or MSYS2: pacman -S sshpass" >&2
              echo "Or use quickstart option 1 as root, or option 2 with a local key file." >&2
              exit 1
            fi
            echo "sshpass is available."
          else
            echo "Cannot continue this step without sshpass. Use option 1 as root, option 2 (local key), or install sshpass and re-run." >&2
            exit 1
          fi
        fi

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
        echo "scp failed. Place id_rsa manually under $KEY_DIR and run: docker compose up -d --build" >&2
        exit 1
      fi
    fi
    chmod 600 "$KEY_DIR/id_rsa"
    # LUX uses this key to SSH as root on the Ludus/Proxmox host (fetch user above is only for copying the file).
    set_kv "PROXMOX_SSH_USER" "root"
    set_kv "PROXMOX_SSH_PASSWORD" ""
    set_kv "PROXMOX_SSH_KEY_PATH" "/app/ssh/id_rsa"
    echo "Key installed. If this key is root's, add the matching public key to /root/.ssh/authorized_keys on the server (see README)."
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
    set_kv "PROXMOX_SSH_USER" "${px_user:-root}"
    set_kv "PROXMOX_SSH_PASSWORD" ""
    set_kv "PROXMOX_SSH_KEY_PATH" "/app/ssh/id_rsa"
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

read -r -p "LUDUS_VERIFY_TLS=true (only if Ludus uses a real CA cert)? [y/N] " vtls
if [[ "${vtls,,}" =~ ^y ]]; then
  set_kv "LUDUS_VERIFY_TLS" "true"
else
  set_kv "LUDUS_VERIFY_TLS" "false"
fi

read -r -p "DISABLE_HTTPS=true (plain HTTP for local browser testing)? [y/N] " dhttp
if [[ "${dhttp,,}" =~ ^y ]]; then
  set_kv "DISABLE_HTTPS" "true"
else
  set_kv "DISABLE_HTTPS" "false"
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

echo ""
read -r -p "Run 'docker compose up -d --build' now? [Y/n] " do_up
do_up="${do_up:-y}"
if [[ "${do_up,,}" =~ ^y ]]; then
  if ! command -v docker &>/dev/null; then
    echo "docker not found in PATH; run manually: docker compose up -d --build" >&2
  else
    docker compose up -d --build
    echo ""
    echo "Stack started."
  fi
else
  echo "Skipped. When ready: docker compose up -d --build"
fi

echo ""
echo "=== Next steps ==="
echo "  • HTTPS: https://localhost (port 443) or https://localhost:3000 — self-signed warning unless you add certificates/"
echo "  • HTTP:  http://localhost:3000"
echo "  • Log in with a Ludus (non-root) SSH user."
echo "  • On the Ludus server: put LUDUS_API_KEY in ~/.bashrc for that user (and root) if needed — see README."
echo "  • In LUX: Settings → Test root SSH & admin API"
echo ""
echo "Done."
