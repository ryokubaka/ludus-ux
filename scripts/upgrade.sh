#!/usr/bin/env bash
# Ludus UX (LUX) — checkout a remote branch or release tag and rebuild the Docker stack.
# Uses whatever git remote you cloned from (GitHub, GitLab, etc.).
#
# Lists only refs that still exist on the remote (via ls-remote), plus release tags.
#
# Usage:
#   bash scripts/upgrade.sh              # interactive: pick branch or tag
#   bash scripts/upgrade.sh main          # non-interactive
#   bash scripts/upgrade.sh v0.9.7        # checkout tag (detached HEAD)
#
# Run from the repository root:
#   bash scripts/upgrade.sh

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f docker-compose.yml ]]; then
  echo "Error: docker-compose.yml not found. Run this script from the ludus-ux repo root." >&2
  exit 1
fi

if ! command -v git &>/dev/null; then
  echo "Error: git is required." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Error: not a git repository." >&2
  exit 1
fi

lux_compose() {
  if docker compose version &>/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null && docker-compose version &>/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Error: Docker Compose not found (tried 'docker compose' and 'docker-compose')." >&2
    exit 1
  fi
}

if ! command -v docker &>/dev/null; then
  echo "Error: docker was not found in PATH." >&2
  exit 1
fi

if ! lux_compose version &>/dev/null; then
  echo "Error: Docker Compose is not available." >&2
  exit 1
fi

# Prefer origin when present (matches most clones); otherwise first remote.
pick_remote() {
  if git remote | grep -qx origin; then
    echo origin
  else
    r="$(git remote | head -n1)"
    if [[ -z "$r" ]]; then
      echo "Error: no git remote configured. Add one with: git remote add origin <url>" >&2
      exit 1
    fi
    echo "$r"
  fi
}

REMOTE="$(pick_remote)"
REMOTE_URL="$(git remote get-url "$REMOTE" 2>/dev/null || echo "?")"

echo "=== Ludus UX (LUX) upgrade ==="
echo ""
echo "Using remote: $REMOTE ($REMOTE_URL)"
echo ""

# Quiet: no "[deleted] …" spam; still prune stale remote-tracking refs and sync tags.
echo "Fetching from $REMOTE (quiet) ..."
git fetch "$REMOTE" --prune --tags --quiet 2>/dev/null \
  || git fetch "$REMOTE" --prune --quiet 2>/dev/null \
  || git fetch "$REMOTE" --prune --tags

# Only refs that exist on the server right now (not stale local remote-tracking branches).
list_remote_heads() {
  git ls-remote --heads "$REMOTE" 2>/dev/null \
    | awk '{print $2}' \
    | sed 's|^refs/heads/||' \
    | grep -vxF '' \
    | { sort -V 2>/dev/null || sort; } || true
}

list_remote_tags() {
  git ls-remote --tags "$REMOTE" 2>/dev/null \
    | awk '{print $2}' \
    | sed 's|^refs/tags/||' \
    | grep -v '\^{}' \
    | grep -vxF '' \
    | { sort -V 2>/dev/null || sort; } || true
}

BRANCHES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && BRANCHES+=("$line")
done < <(list_remote_heads)

TAGS=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  dup=0
  for b in "${BRANCHES[@]}"; do
    if [[ "$b" == "$line" ]]; then dup=1; break; fi
  done
  [[ $dup -eq 0 ]] && TAGS+=("$line")
done < <(list_remote_tags)

if [[ ${#BRANCHES[@]} -eq 0 && ${#TAGS[@]} -eq 0 ]]; then
  echo "Error: no branches or tags found on $REMOTE (ls-remote returned empty)." >&2
  exit 1
fi

# Parallel arrays for interactive menu: same index = one selectable ref.
NAMES=()
KINDS=() # branch | tag
OPTIONS=()

i=0
for b in "${BRANCHES[@]}"; do
  NAMES[$i]="$b"
  KINDS[$i]="branch"
  OPTIONS[$i]="${b} [branch]"
  i=$((i + 1))
done
for t in "${TAGS[@]}"; do
  NAMES[$i]="$t"
  KINDS[$i]="tag"
  OPTIONS[$i]="${t} [tag]"
  i=$((i + 1))
done

CURRENT="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
echo "Current checkout: $CURRENT"
echo ""

TARGET=""
KIND=""
if [[ $# -ge 1 ]]; then
  TARGET="$1"
  found=0
  j=0
  while [[ $j -lt $i ]]; do
    if [[ "${NAMES[$j]}" == "$TARGET" ]]; then
      KIND="${KINDS[$j]}"
      found=1
      break
    fi
    j=$((j + 1))
  done
  if [[ "$found" -ne 1 ]]; then
    echo "Error: '$TARGET' is not a branch or tag on $REMOTE." >&2
    echo "Available branches:" >&2
    printf '  %s\n' "${BRANCHES[@]}" >&2
    echo "Available tags:" >&2
    printf '  %s\n' "${TAGS[@]}" >&2
    exit 1
  fi
else
  PS3="Enter number (or Ctrl+C to cancel): "
  select choice in "${OPTIONS[@]}"; do
    if [[ -z "$choice" ]]; then
      echo "Invalid selection."
      continue
    fi
    j=0
    found_sel=0
    while [[ $j -lt $i ]]; do
      if [[ "${OPTIONS[$j]}" == "$choice" ]]; then
        TARGET="${NAMES[$j]}"
        KIND="${KINDS[$j]}"
        found_sel=1
        break
      fi
      j=$((j + 1))
    done
    if [[ "$found_sel" -eq 1 ]]; then
      break
    fi
    echo "Invalid selection."
  done
fi

if [[ -z "$TARGET" || -z "$KIND" ]]; then
  echo "Nothing selected."
  exit 1
fi

DIRTY="$(git status --porcelain 2>/dev/null || true)"
if [[ -n "$DIRTY" ]]; then
  echo "Warning: working tree has uncommitted changes."
  echo "          Checkout may discard tracked changes (especially when switching branch/tag)."
  echo ""
  read -r -p "Continue? [y/N] " cont
  if [[ ! "$cont" =~ ^[Yy] ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""

if [[ "$KIND" == "branch" ]]; then
  REMOTE_REF="${REMOTE}/${TARGET}"
  if ! git rev-parse --verify "$REMOTE_REF" >/dev/null 2>&1; then
    git fetch "$REMOTE" --quiet 2>/dev/null || git fetch "$REMOTE"
  fi
  if ! git rev-parse --verify "$REMOTE_REF" >/dev/null 2>&1; then
    echo "Error: missing ref $REMOTE_REF after fetch." >&2
    exit 1
  fi
  echo "Checking out branch $TARGET (tracking $REMOTE_REF) ..."
  if git show-ref --verify --quiet "refs/heads/$TARGET"; then
    git checkout -f "$TARGET"
  else
    git checkout -B "$TARGET" "$REMOTE_REF"
  fi
  git reset --hard "$REMOTE_REF"
else
  echo "Checking out tag $TARGET (detached HEAD) ..."
  git fetch "$REMOTE" "refs/tags/$TARGET:refs/tags/$TARGET" --quiet 2>/dev/null || true
  if ! git rev-parse --verify "$TARGET^{commit}" >/dev/null 2>&1; then
    echo "Error: tag '$TARGET' not found after fetch." >&2
    exit 1
  fi
  git checkout -f "$TARGET"
fi

echo ""
echo "Rebuilding and restarting stack ..."
lux_compose up -d --build

echo ""
echo "Done. Running:"
git log -1 --oneline
echo ""
echo "Tip: confirm UI version under Settings → About."
