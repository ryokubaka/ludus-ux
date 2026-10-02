#!/bin/bash
# Drop inherited sockets so a child cannot write into the SSH session.
fds=()
for fd in /proc/self/fd/*; do
  n="${fd##*/}"
  [[ "$n" =~ ^[0-9]+$ ]] || continue
  if [[ "$n" -gt 2 ]]; then fds+=("$n"); fi
done
for n in "${fds[@]}"; do
  eval "exec ${n}>&-" 2>/dev/null || true
done
echo NSREADY >&2
read -r _ < "$RELEASE_FIFO"
mkdir -p /tmp/real-etc
mount --bind /etc /tmp/real-etc || { echo "mount real /etc failed" >&2; exit 89; }
mount --bind "$FAKE_ETC" /etc || { echo "mount /etc failed" >&2; exit 90; }
if [[ -d /tmp/real-etc/alternatives ]]; then
  mkdir -p /etc/alternatives
  mount --bind /tmp/real-etc/alternatives /etc/alternatives || { echo "mount alternatives failed" >&2; exit 93; }
fi
mkdir -p /usr/local
mount --bind "$FAKE_USR_LOCAL" /usr/local || { echo "mount /usr/local failed" >&2; exit 91; }
mkdir -p /opt
mount --bind "$FAKE_OPT" /opt || { echo "mount /opt failed" >&2; exit 92; }
if [[ -f /opt/ludus/.sticky-ro && -d /opt/ludus/packer/sticky-template ]]; then
  mount --bind /opt/ludus/packer/sticky-template /opt/ludus/packer/sticky-template || true
  mount -o remount,bind,ro /opt/ludus/packer/sticky-template || true
fi
export PATH="$HOST_BIN:/usr/bin:/bin"
export HOME=/tmp/lux-empty-home
mkdir -p "$HOME"
export PYTHONPATH="$PY_PATH${PYTHONPATH:+:$PYTHONPATH}"
export SUDO_USER="${SUDO_USER:-luxuser}"
export LUX_SYSTEMD_RECORD="${LUX_SYSTEMD_RECORD:-/tmp/systemd-run-args.txt}"
if [[ -n "${REPO:-}" && -d "$REPO" ]]; then
  chown -R luxuser:luxuser "$REPO" 2>/dev/null || true
fi
bash "$CMD_FILE"
exit $?
