import { runHostScriptViaDocker } from "../src/lib/lux-upgrade-docker.ts"
import { wrapEncodedHostShellScript } from "../src/lib/lux-upgrade-host.ts"

const inner = `cd / 2>/dev/null || cd /tmp
export PWD=/ HOME=/root
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export DOCKER_HOST='unix:///var/run/docker.sock'
_LUX_DOCKER=""
_lux_docker() { if [ -n "$_LUX_DOCKER" ]; then "$_LUX_DOCKER" "$@"; return $?; fi; for _c in docker /usr/bin/docker /usr/local/bin/docker; do if command -v "$_c" >/dev/null 2>&1; then _LUX_DOCKER="$_c"; "$_LUX_DOCKER" "$@"; return $?; fi; done; return 127; }
REPO=""
_lux_try_repo() { _P="$1"; if [ -n "$_P" ] && [ "$_P" != "." ] && [ -f "$_P/docker-compose.yml" ]; then REPO="$_P"; fi }
_lux_norm_path() { printf '%s' "$1"; }
_lux_path_tail() { _lux_norm_path "$1" | sed 's|^[A-Za-z]:||'; }
_lux_try_host_roots() { _T="$1"; _T="\${_T#/}"; if [ -d /run/desktop/mnt/host ]; then for _H in /run/desktop/mnt/host/*/; do _lux_try_repo "\${_H%/}/$_T"; [ -n "$REPO" ] && return 0; done; fi; if [ -d /mnt ]; then for _H in /mnt/*/; do _lux_try_repo "\${_H%/}/$_T"; [ -n "$REPO" ] && return 0; done; fi; return 1; }
_lux_try_client_path() { _P="$(_lux_norm_path "$1")"; _lux_try_repo "$_P"; [ -n "$REPO" ] && return 0; _lux_try_repo "$(dirname "$_P")"; [ -n "$REPO" ] && return 0; _T="$(_lux_path_tail "$_P")"; _lux_try_repo "$_T"; [ -n "$REPO" ] && return 0; _lux_try_host_roots "$(dirname "$_T")"; [ -n "$REPO" ] && return 0; _lux_try_host_roots "$_T"; return 1; }
_lux_try_client_path 'E:/gitlab/ludus-ux/data'
DATA_SRC=$(_lux_docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' 'ludus-ux' 2>/dev/null || true); _lux_try_client_path "$DATA_SRC"
if [ -z "$REPO" ]; then _WD=$(_lux_docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 'ludus-ux' 2>/dev/null || true); _lux_try_client_path "$_WD"; fi
printf 'repo=%s\\n' "$REPO"`.split("\n")

const out = await runHostScriptViaDocker(wrapEncodedHostShellScript(inner))
console.log(out)
