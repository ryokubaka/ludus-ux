# Shared by scripts/upgrade.sh and the About release lookup.
# POSIX sh. Source it; do not execute it.
#
# Docker Desktop bind mounts are owned by root and mode 777, so OpenSSH
# ignores the key that `git pull` uses for the person who started the
# container. Copy that profile's .ssh into a private directory, use it for
# one command, then delete it. A checkout owned by a real Unix user still
# runs as that user. Public remotes need no key.

# Quote for inclusion in GIT_SSH_COMMAND, which git passes to a shell.
lux_git_shell_quote() {
  _q=$(printf '%s' "$1" | sed "s/'/'\\\\''/g")
  printf "'%s'" "$_q"
}

lux_git_ssh_host() {
  _url=$1
  case "$_url" in
    git@*:*)
      _host=${_url#git@}
      _host=${_host%%:*}
      ;;
    ssh://*@*/*)
      _host=${_url#ssh://}
      _host=${_host#*@}
      _host=${_host%%/*}
      _host=${_host%%:*}
      ;;
    ssh://*/*)
      _host=${_url#ssh://}
      _host=${_host%%/*}
      _host=${_host%%:*}
      ;;
    *)
      _host=""
      ;;
  esac
  case "$_host" in
    ""|*[!A-Za-z0-9.-]*) printf '' ;;
    *) printf '%s' "$_host" ;;
  esac
}

lux_profile_has_key() {
  _dir=$1/.ssh
  [ -d "$_dir" ] || return 1
  for _k in "$_dir"/id_*; do
    [ -f "$_k" ] || continue
    [ -L "$_k" ] && continue
    case "$_k" in
      *.pub) continue ;;
    esac
    return 0
  done
  return 1
}

lux_profile_mentions_host() {
  _file=$1
  _needle=$2
  [ -f "$_file" ] || return 1
  grep -F -q -- "$_needle" "$_file"
}

# Print the home directory whose SSH config should authenticate _host.
# LUX_SSH_PROFILE_BASE overrides the Docker Desktop user-profile mount (tests).
lux_ssh_profile_for_host() {
  _host=$1
  [ -n "$_host" ] || return 1
  if [ -n "${LUX_SSH_PROFILE_BASE:-}" ]; then
    _bases=$LUX_SSH_PROFILE_BASE
  else
    _bases="/run/desktop/mnt/host/c/Users
/run/desktop/mnt/host/C/Users
/mnt/c/Users
/host_mnt/c/Users"
  fi
  _only=""
  _count=0
  _from_config=""
  _config_count=0
  _from_known=""
  _known_count=0
  _oldifs=$IFS
  IFS='
'
  for _base in $_bases; do
    [ -d "$_base" ] || continue
    for _home in "$_base"/*; do
      [ -d "$_home" ] || continue
      _name=${_home##*/}
      case "$_name" in
        Public|Default|Default\ User|All\ Users|WsiAccount|defaultuser0|.*) continue ;;
      esac
      lux_profile_has_key "$_home" || continue
      _count=$((_count + 1))
      _only=$_home
      if lux_profile_mentions_host "$_home/.ssh/config" "$_host"; then
        _from_config=$_home
        _config_count=$((_config_count + 1))
      elif lux_profile_mentions_host "$_home/.ssh/known_hosts" "$_host"; then
        _from_known=$_home
        _known_count=$((_known_count + 1))
      fi
    done
  done
  IFS=$_oldifs
  if [ "$_config_count" -eq 1 ]; then
    printf '%s' "$_from_config"
    return 0
  fi
  if [ "$_config_count" -eq 0 ] && [ "$_known_count" -eq 1 ]; then
    printf '%s' "$_from_known"
    return 0
  fi
  if [ "$_count" -eq 1 ]; then
    printf '%s' "$_only"
    return 0
  fi
  return 1
}

# Copy .ssh to a 0700 directory. Prints the new HOME. Caller deletes it.
lux_stage_ssh_home() {
  _src=$1/.ssh
  _stage=$(mktemp -d) || return 1
  chmod 700 "$_stage" || { rm -rf "$_stage"; return 1; }
  mkdir -m 700 "$_stage/.ssh" || { rm -rf "$_stage"; return 1; }
  for _f in "$_src"/*; do
    [ -f "$_f" ] || continue
    [ -L "$_f" ] && continue
    _bn=${_f##*/}
    case "$_bn" in
      *[!A-Za-z0-9._-]*) continue ;;
      config|known_hosts|known_hosts.old|id_*|*.pub) ;;
      *) continue ;;
    esac
    if [ "$_bn" = "config" ] || [ "$_bn" = "known_hosts" ] || [ "$_bn" = "known_hosts.old" ]; then
      tr -d '\015' < "$_f" > "$_stage/.ssh/$_bn"
    else
      cp "$_f" "$_stage/.ssh/$_bn" || { rm -rf "$_stage"; return 1; }
    fi
    chmod 600 "$_stage/.ssh/$_bn" || { rm -rf "$_stage"; return 1; }
  done
  if [ -f "$_stage/.ssh/config" ]; then
    _rewritten=$(mktemp) || { rm -rf "$_stage"; return 1; }
    while IFS= read -r _line || [ -n "$_line" ]; do
      _key=$(printf '%s' "$_line" | awk '{print tolower($1)}')
      if [ "$_key" = "identityfile" ]; then
        _path=$(printf '%s' "$_line" | awk '{print $2}' | tr -d '"' | tr -d "'")
        _base=${_path##*/}
        _base=${_base##*\\}
        case "$_base" in
          *[!A-Za-z0-9._-]*) printf '%s\n' "$_line" ;;
          *)
            if [ -f "$_stage/.ssh/$_base" ]; then
              printf 'IdentityFile %s\n' "$_stage/.ssh/$_base"
            else
              printf '%s\n' "$_line"
            fi
            ;;
        esac
      else
        printf '%s\n' "$_line"
      fi
    done < "$_stage/.ssh/config" > "$_rewritten"
    mv "$_rewritten" "$_stage/.ssh/config"
    chmod 600 "$_stage/.ssh/config"
  fi
  printf '%s' "$_stage"
}

# lux_run_git <remote-url> -- <command...>
# Restores nothing global: HOME and GIT_SSH_COMMAND are set only for the command.
lux_run_git() {
  _url=$1
  shift
  [ "${1:-}" = "--" ] && shift
  _host=$(lux_git_ssh_host "$_url")
  _repo_uid=$(stat -c %u . 2>/dev/null || echo 0)
  if [ "$(id -u)" -eq 0 ] && [ "$_repo_uid" != "0" ] && command -v runuser >/dev/null 2>&1; then
    _home=$(getent passwd "$_repo_uid" | awk -F: '{print $6}')
    _user=$(getent passwd "$_repo_uid" | awk -F: '{print $1}')
    if [ -n "$_home" ] && [ -n "$_user" ] && lux_profile_has_key "$_home"; then
      _ssh="ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"
      if [ -f "$_home/.ssh/config" ]; then
        _ssh="$_ssh -F $(lux_git_shell_quote "$_home/.ssh/config")"
      fi
      if runuser -u "$_user" -- env HOME="$_home" GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$_ssh" "$@"; then
        return 0
      else
        return $?
      fi
    fi
  fi
  _profile=""
  if [ -n "$_host" ]; then
    _profile=$(lux_ssh_profile_for_host "$_host" || true)
  fi
  if [ -z "$_profile" ]; then
    if GIT_TERMINAL_PROMPT=0 "$@"; then
      return 0
    else
      return $?
    fi
  fi
  _stage=$(lux_stage_ssh_home "$_profile") || {
    if GIT_TERMINAL_PROMPT=0 "$@"; then
      return 0
    else
      return $?
    fi
  }
  _ssh="ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"
  if [ -f "$_stage/.ssh/config" ]; then
    _ssh="$_ssh -F $(lux_git_shell_quote "$_stage/.ssh/config")"
  fi
  if env HOME="$_stage" GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$_ssh" "$@"; then
    _rc=0
  else
    _rc=$?
  fi
  rm -rf "$_stage"
  return $_rc
}
