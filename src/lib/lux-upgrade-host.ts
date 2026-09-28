import fs from "node:fs"
import path from "node:path"
import { shellSingleQuote } from "@/lib/template-packer-paths"
import { isLuxReleaseTag } from "@/lib/lux-version"

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data")

export const LUX_UPGRADE_LOG_NAME = "lux-upgrade.log"

export type LuxHostCapability = {
  canSwitch: boolean
  repoPath: string | null
  dirty: boolean
  checkout: string | null
  reason: string | null
}

export function luxUpgradeLogPath(): string {
  return path.join(DATA_DIR, LUX_UPGRADE_LOG_NAME)
}

/** Host path to the ludus-ux git clone. Must be absolute and free of metacharacters. */
export function isSafeLuxRepoPath(raw: string): boolean {
  const p = raw.trim()
  if (!p.startsWith("/")) return false
  if (p.includes("\0") || p.includes("\n") || p.includes("\r")) return false
  if (p.includes("..")) return false
  return /^\/[A-Za-z0-9._/-]+$/.test(p)
}

export function resolveConfiguredLuxRepoPath(): string | null {
  const raw = (process.env.LUX_REPO_PATH ?? "").trim()
  if (!raw) return null
  return isSafeLuxRepoPath(raw) ? raw : null
}

export function buildHostProbeCmd(explicitRepo: string | null): string {
  const provided =
    explicitRepo && isSafeLuxRepoPath(explicitRepo) ? explicitRepo : ""
  const inspect =
    `docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' ludus-ux`
  return [
    `PROVIDED=${shellSingleQuote(provided)}`,
    `if [ -n "$PROVIDED" ]; then REPO="$PROVIDED"; else REPO=$(${inspect} 2>/dev/null || true); fi`,
    `REPO=$(printf '%s' "$REPO" | tr -d "\\r")`,
    `printf 'repo=%s\\n' "$REPO"`,
    `if [ -z "$REPO" ]; then printf 'ok=no\\nreason=not_found\\n'; exit 0; fi`,
    `if [ ! -f "$REPO/docker-compose.yml" ]; then printf 'compose=no\\n'; else printf 'compose=yes\\n'; fi`,
    `if [ ! -f "$REPO/scripts/upgrade.sh" ]; then printf 'script=no\\n'; else printf 'script=yes\\n'; fi`,
    `if [ ! -d "$REPO/.git" ]; then printf 'git=no\\n'; else printf 'git=yes\\n'; fi`,
    `if ! cd "$REPO"; then printf 'ok=no\\nreason=not_found\\n'; exit 0; fi`,
    `GIT_ROOT=$(pwd -P)`,
    `GIT_CONFIG_COUNT=1`,
    `GIT_CONFIG_KEY_0=safe.directory`,
    `GIT_CONFIG_VALUE_0="$GIT_ROOT"`,
    `export GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0`,
    `if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then printf 'git_ok=no\\n'; printf 'ok=no\\nreason=git_failed\\n'; exit 0; fi`,
    `DIRTY=$(git status --porcelain 2>/dev/null) || { printf 'git_ok=no\\n'; printf 'ok=no\\nreason=git_failed\\n'; exit 0; }`,
    `if [ -n "$DIRTY" ]; then printf 'dirty=yes\\n'; else printf 'dirty=no\\n'; fi`,
    `printf 'checkout=%s\\n' "$(git describe --tags --exact-match 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"`,
    `printf 'ok=yes\\n'`,
  ].join("; ")
}

export function parseHostProbe(output: string): LuxHostCapability {
  const text = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const repoRaw = /^repo=(.*)$/m.exec(text)?.[1]?.trim() ?? ""
  const repoPath = isSafeLuxRepoPath(repoRaw) ? repoRaw : null
  const compose = /^compose=yes$/m.test(text)
  const script = /^script=yes$/m.test(text)
  const git = /^git=yes$/m.test(text)
  const dirty = /^dirty=yes$/m.test(text)
  const checkout = /^checkout=(.*)$/m.exec(text)?.[1]?.trim() || null

  if (!repoPath) {
    return {
      canSwitch: false,
      repoPath: null,
      dirty: false,
      checkout: null,
      reason:
        "Could not find the LUX git clone on the Ludus host. Set LUX_REPO_PATH or run bash scripts/upgrade.sh on the machine that runs Docker Compose.",
    }
  }
  if (/^git_ok=no$/m.test(text) || /^reason=git_failed$/m.test(text)) {
    return {
      canSwitch: false,
      repoPath,
      dirty: false,
      checkout,
      reason:
        "Git could not read this clone, so upgrade and downgrade stay off until git can inspect the working tree.",
    }
  }
  if (!compose || !script || !git) {
    return {
      canSwitch: false,
      repoPath,
      dirty,
      checkout,
      reason:
        "The resolved directory is missing docker-compose.yml, scripts/upgrade.sh, or a git checkout. Set LUX_REPO_PATH to the clone root.",
    }
  }
  return { canSwitch: true, repoPath, dirty, checkout, reason: null }
}

export function buildStartUpgradeCmd(repoPath: string, tag: string): string {
  if (!isSafeLuxRepoPath(repoPath)) {
    throw new Error("Unsafe repository path")
  }
  if (!isLuxReleaseTag(tag)) {
    throw new Error("Invalid release tag")
  }
  const dataInspect =
    `docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' ludus-ux`
  const service = [
    `bash "$REPO/scripts/upgrade.sh" "$TAG" >> "$LOG" 2>&1`,
    `printf 'LUX_UPGRADE_EXIT:%s\\n' "$?" >> "$LOG"`,
  ].join("; ")
  return [
    `REPO=${shellSingleQuote(repoPath)}`,
    `TAG=${shellSingleQuote(tag)}`,
    `DATA=$(${dataInspect} 2>/dev/null || true)`,
    `if [ -z "$DATA" ]; then DATA="$REPO/data"; fi`,
    `mkdir -p "$DATA"`,
    `LOG="$DATA/lux-upgrade.log"`,
    `printf '%s\\n' "=== LUX switch to $TAG started $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" > "$LOG"`,
    `command -v systemd-run >/dev/null 2>&1 || { echo "Error: systemd-run not found"; exit 1; }`,
    `systemd-run --collect --setenv=REPO="$REPO" --setenv=TAG="$TAG" --setenv=LOG="$LOG" --setenv=LUX_UPGRADE_YES=1 /bin/bash -c ${shellSingleQuote(service)} && echo started`,
  ].join("; ")
}

const SWITCH_START_LINE = /^=== LUX switch to \S+ started[^\n]*\n?/gm

function lastSwitchStartLine(raw: string): { start: number; end: number } | null {
  let found: { start: number; end: number } | null = null
  for (const match of raw.matchAll(SWITCH_START_LINE)) {
    const start = match.index
    if (start === undefined) continue
    found = { start, end: start + match[0].length }
  }
  return found
}

function joinLogParts(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  if (left.endsWith("\n") || right.startsWith("\n")) return left + right
  return `${left}\n${right}`
}

export function windowLuxUpgradeLog(raw: string, maxChars = 8000): string {
  if (maxChars <= 0) return ""
  if (raw.length <= maxChars) return raw

  const marker = lastSwitchStartLine(raw)
  if (!marker) return raw.slice(-maxChars)

  const fromMarker = raw.slice(marker.start)
  if (fromMarker.length <= maxChars) return fromMarker

  const markerText = raw.slice(marker.start, marker.end)
  const half = Math.floor(maxChars / 2)
  let headEnd = Math.min(raw.length, marker.start + Math.max(half, markerText.length))
  if (headEnd < marker.end) headEnd = marker.end
  if (headEnd < raw.length && raw[headEnd - 1] !== "\n") {
    const back = raw.lastIndexOf("\n", headEnd - 1)
    if (back + 1 >= marker.end) headEnd = back + 1
  }
  if (headEnd < marker.end) headEnd = marker.end
  const head = raw.slice(marker.start, headEnd)

  const exitPos = raw.lastIndexOf("LUX_UPGRADE_EXIT:")
  let exitLine = ""
  if (exitPos >= marker.start) {
    const exitEnd = raw.indexOf("\n", exitPos)
    exitLine = raw.slice(exitPos, exitEnd === -1 ? raw.length : exitEnd + 1)
  }

  const room = Math.max(0, maxChars - head.length)
  let tail = ""
  if (room > 0 && headEnd < raw.length) {
    let tailStart = Math.max(headEnd, raw.length - room)
    if (tailStart > headEnd && raw[tailStart - 1] !== "\n") {
      const nl = raw.indexOf("\n", tailStart)
      if (nl >= 0 && nl + 1 < raw.length) tailStart = nl + 1
    }
    tail = raw.slice(tailStart)
  }

  let combined = joinLogParts(head, tail)
  if (exitLine && !combined.includes(exitLine)) combined = joinLogParts(combined, exitLine)
  return combined
}

export function readLuxUpgradeLogTail(maxChars = 8000, logFile = luxUpgradeLogPath()): string {
  try {
    if (!fs.existsSync(logFile)) return ""
    const raw = fs.readFileSync(logFile, "utf8")
    return windowLuxUpgradeLog(raw, maxChars)
  } catch {
    return ""
  }
}
