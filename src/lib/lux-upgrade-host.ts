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

/** Bind mount target for SQLite/task data in the ludus-ux service (see docker-compose.yml). */
export const LUX_DATA_MOUNT_DEST = "/app/data"

export type LuxHostProbeOptions = {
  /** Running ludus-ux container name or id (from Docker API, not hardcoded on the host). */
  containerRef: string
  /** POSIX paths safe to test directly on the host shell (Linux paths, LUX_REPO_PATH, etc.). */
  candidates: string[]
  /** Raw paths from the Docker API (often client paths like E:/…); translated on the host when needed. */
  clientPaths?: string[]
}

/** Normalize paths from Docker inspect (CRLF, backslashes); no host-specific rewriting. */
export function normalizeLuxHostRepoPath(raw: string): string {
  return raw.trim().replace(/\r/g, "").replace(/\\/g, "/").replace(/\/+$/, "")
}

export function isSafeDockerContainerRef(ref: string): boolean {
  const r = ref.trim()
  if (!r || r.length > 128) return false
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(r)
}

export function isSafeLuxRepoPath(raw: string): boolean {
  const p = normalizeLuxHostRepoPath(raw)
  if (!p || p.includes("\0") || p.includes("\n") || p.includes("..")) return false
  if (/[;&|$`<>()]/.test(p)) return false
  if (p.startsWith("/")) return /^\/[A-Za-z0-9._/-]+$/.test(p)
  if (/^[A-Za-z]:\/[A-Za-z0-9._/ -]+$/.test(p)) return true
  return false
}

export function resolveConfiguredLuxRepoPath(): string | null {
  const raw = (process.env.LUX_REPO_PATH ?? "").trim()
  if (!raw) return null
  const norm = normalizeLuxHostRepoPath(raw)
  return isSafeLuxRepoPath(norm) ? norm : null
}

/** Repo root directory from a /app/data bind-mount Source (handles \\ and mixed separators). */
export function bindMountRepoRoot(source: string): string | null {
  const norm = normalizeLuxHostRepoPath(source.trim())
  if (!norm || norm === "." || norm === "/") return null
  const slash = norm.lastIndexOf("/")
  if (slash <= 0) return null
  const root = norm.slice(0, slash)
  return isSafeLuxRepoPath(root) ? root : null
}

/** Paths with a drive letter are not usable inside the POSIX host shell nsenter uses. */
export function filterHostShellRepoCandidates(paths: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const norm = normalizeLuxHostRepoPath(raw)
    if (!isSafeLuxRepoPath(norm) || seen.has(norm)) continue
    if (/^[A-Za-z]:\//.test(norm)) continue
    seen.add(norm)
    out.push(norm)
  }
  return out
}

const HOST_DOCKER_SOCKET = (process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock").replace(/'/g, "'\\''")

/** Shared shell prefix for nsenter host scripts (cwd, PATH, docker CLI). */
export function hostShellScriptPreambleLines(): string[] {
  return [
    `cd / 2>/dev/null || cd /tmp`,
    `export PWD=/ HOME=/root`,
    `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"`,
    `export DOCKER_HOST='${HOST_DOCKER_SOCKET}'`,
    `_LUX_DOCKER=""`,
    `_lux_docker() { if [ -n "$_LUX_DOCKER" ]; then "$_LUX_DOCKER" "$@"; return $?; fi; for _c in docker /usr/bin/docker /usr/local/bin/docker; do if command -v "$_c" >/dev/null 2>&1; then _LUX_DOCKER="$_c"; "$_LUX_DOCKER" "$@"; return $?; fi; done; return 127; }`,
  ]
}

export function hostShellScriptPreamble(): string {
  return hostShellScriptPreambleLines().join("; ")
}

/** Avoid nested sh -c quoting bugs by piping a base64-encoded script to /bin/sh on the host. */
export function wrapEncodedHostShellScript(innerLines: string[]): string {
  const inner = innerLines.join("\n")
  const b64 = Buffer.from(inner, "utf8").toString("base64")
  if (b64.length > 240_000) {
    throw new Error("Host shell script exceeds the encoded size limit")
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
    throw new Error("Host shell script produced unexpected base64")
  }
  return `cd / 2>/dev/null || cd /tmp; printf '%s' '${b64}' | base64 -d | /bin/sh`
}

/** Shell helpers: map Docker API client paths to paths the POSIX host shell can stat (e.g. bind-mount mirrors). */
export function hostClientPathResolverLines(): string[] {
  return [
    `_lux_norm_path() { printf '%s' "$1"; }`,
    `_lux_path_tail() { _lux_norm_path "$1" | sed 's|^[A-Za-z]:||'; }`,
    `_lux_try_host_roots() { _T="$1"; _T="\${_T#/}"; if [ -d /run/desktop/mnt/host ]; then for _H in /run/desktop/mnt/host/*/; do _lux_try_repo "\${_H%/}/$_T"; [ -n "$REPO" ] && return 0; done; fi; if [ -d /mnt ]; then for _H in /mnt/*/; do _lux_try_repo "\${_H%/}/$_T"; [ -n "$REPO" ] && return 0; done; fi; return 1; }`,
    `_lux_try_client_path() { _P="$(_lux_norm_path "$1")"; _lux_try_repo "$_P"; [ -n "$REPO" ] && return 0; _lux_try_repo "$(dirname "$_P")"; [ -n "$REPO" ] && return 0; _T="$(_lux_path_tail "$_P")"; _lux_try_repo "$_T"; [ -n "$REPO" ] && return 0; _lux_try_host_roots "$(dirname "$_T")"; [ -n "$REPO" ] && return 0; _lux_try_host_roots "$_T"; return 1; }`,
  ]
}

export function hostClientPathResolverShell(): string {
  return hostClientPathResolverLines().join("; ")
}

export function buildHostProbeCmd(opts: LuxHostProbeOptions): string {
  const containerRef = isSafeDockerContainerRef(opts.containerRef)
    ? opts.containerRef.trim()
    : "ludus-ux"
  const quotedContainer = shellSingleQuote(containerRef)
  const candidates = [
    ...new Set(
      opts.candidates.map((c) => normalizeLuxHostRepoPath(c)).filter((c) => isSafeLuxRepoPath(c)),
    ),
  ]
  const inspectWd = `_lux_docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' ${quotedContainer}`
  const inspectData = `_lux_docker inspect -f '{{range .Mounts}}{{if eq .Destination "${LUX_DATA_MOUNT_DEST}"}}{{.Source}}{{end}}{{end}}' ${quotedContainer}`
  const tryCandidates =
    candidates.length > 0
      ? candidates.map((c) => `_lux_try_repo ${shellSingleQuote(c)}`).join("; ")
      : ""
  const clientPaths = [
    ...new Set(
      (opts.clientPaths ?? [])
        .map((p) => normalizeLuxHostRepoPath(p))
        .filter((p) => p.length > 0 && p.length <= 512 && isSafeLuxRepoPath(p)),
    ),
  ]
  const inner: string[] = [
    ...hostShellScriptPreambleLines(),
    `REPO=""`,
    `_lux_try_repo() { if [ -n "$1" ] && [ "$1" != "." ] && [ -f "$1/docker-compose.yml" ]; then REPO="$1"; fi }`,
    ...hostClientPathResolverLines(),
    ...clientPaths.map((c) => `_lux_try_client_path ${shellSingleQuote(c)}`),
    `DATA_SRC=$(${inspectData} 2>/dev/null || true); _lux_try_client_path "$DATA_SRC"`,
    `if [ -z "$REPO" ]; then _WD=$(${inspectWd} 2>/dev/null || true); _lux_try_client_path "$_WD"; fi`,
  ]
  if (tryCandidates) {
    inner.push(`if [ -z "$REPO" ]; then ${tryCandidates}; fi`)
  }
  inner.push(
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
  )
  return wrapEncodedHostShellScript(inner)
}

export function parseHostProbe(output: string): LuxHostCapability {
  const text = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const repoRaw = /^repo=(.*)$/m.exec(text)?.[1]?.trim() ?? ""
  const repoNorm = normalizeLuxHostRepoPath(repoRaw)
  const repoPath = isSafeLuxRepoPath(repoNorm) ? repoNorm : null
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
        "Could not find the LUX git clone on the Docker host. Run Compose from the ludus-ux checkout (with ./data mounted at /app/data), or set LUX_REPO_PATH as an override.",
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
        "The resolved directory is missing docker-compose.yml, scripts/upgrade.sh, or a git checkout. Start Compose from the ludus-ux repo root, or set LUX_REPO_PATH to that directory.",
    }
  }
  return { canSwitch: true, repoPath, dirty, checkout, reason: null }
}

export function buildStartUpgradeCmd(
  repoPath: string,
  tag: string,
  containerRef?: string,
): string {
  if (!isSafeLuxRepoPath(repoPath)) {
    throw new Error("Unsafe repository path")
  }
  if (!isLuxReleaseTag(tag)) {
    throw new Error("Invalid release tag")
  }
  const ref = isSafeDockerContainerRef(containerRef ?? "")
    ? containerRef!.trim()
    : "ludus-ux"
  const dataInspect = `_lux_docker inspect -f '{{range .Mounts}}{{if eq .Destination "${LUX_DATA_MOUNT_DEST}"}}{{.Source}}{{end}}{{end}}' ${shellSingleQuote(ref)}`
  const service = [
    `bash "$REPO/scripts/upgrade.sh" "$TAG" >> "$LOG" 2>&1`,
    `echo "LUX_UPGRADE_EXIT:$?" >> "$LOG"`,
  ].join("; ")
  return wrapEncodedHostShellScript([
    ...hostShellScriptPreambleLines(),
    `REPO=${shellSingleQuote(repoPath)}`,
    `TAG=${shellSingleQuote(tag)}`,
    `DATA=$(${dataInspect} 2>/dev/null || true)`,
    `if [ -z "$DATA" ]; then DATA="$REPO/data"; fi`,
    `mkdir -p "$DATA"`,
    `LOG="$DATA/lux-upgrade.log"`,
    `printf '%s\\n' "=== LUX switch to $TAG started $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" > "$LOG"`,
    `command -v systemd-run >/dev/null 2>&1 || { echo "Error: systemd-run not found"; exit 1; }`,
    `systemd-run --collect --setenv=REPO="$REPO" --setenv=TAG="$TAG" --setenv=LOG="$LOG" --setenv=LUX_UPGRADE_YES=1 /bin/bash -c ${shellSingleQuote(service)} && echo started`,
  ])
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
