/**
 * LudusHound SSH helpers — reuses GOAD SSH transport; no Ludus CLI PATH wrapper.
 */

import "server-only"

import { sshExec, type SSHCreds, isGoadConfigured } from "@/lib/goad-ssh"
import { resolveLudushoundPath } from "@/lib/runtime-paths"
import {
  LUDUSHOUND_COLLECTION_TARBALL,
  LUDUSHOUND_GIT_URL,
  LUDUSHOUND_GO_VERSION,
  shellQuote,
  type LudushoundGenerateArgs,
  buildLudushoundCommand,
} from "@/lib/ludushound-wizard-args"

export { type SSHCreds }

export function isLudushoundSshConfigured(): boolean {
  return isGoadConfigured()
}

export interface LudushoundHostProbe {
  configured: boolean
  ludushoundPath: string
  repoPresent: boolean
  binaryPresent: boolean
  goAvailable: boolean
  collectionTarballPresent: boolean
  collectionTarballPath: string
  error?: string
}

function safePath(p: string): string {
  return p.replace(/'/g, "")
}

export async function probeLudushoundHost(creds?: SSHCreds): Promise<LudushoundHostProbe> {
  const ludushoundPath = resolveLudushoundPath()
  if (!isLudushoundSshConfigured()) {
    return {
      configured: false,
      ludushoundPath,
      repoPresent: false,
      binaryPresent: false,
      goAvailable: false,
      collectionTarballPresent: false,
      collectionTarballPath: `${ludushoundPath}/Collections/${LUDUSHOUND_COLLECTION_TARBALL}`,
      error: "SSH not configured. Set LUDUS_SSH_HOST.",
    }
  }

  const root = safePath(ludushoundPath)
  const tarball = `${root}/Collections/${LUDUSHOUND_COLLECTION_TARBALL}`
  const cmd = [
    `ROOT=${shellQuote(root)}`,
    `TB=${shellQuote(tarball)}`,
    `export PATH="/usr/local/go/bin:$PATH"`,
    `echo REPO:$( [ -d "$ROOT" ] && echo 1 || echo 0 )`,
    `echo BIN:$( [ -x "$ROOT/LudusHound" ] && echo 1 || echo 0 )`,
    `echo GO:$( command -v go >/dev/null 2>&1 && echo 1 || echo 0 )`,
    `echo TB:$( [ -f "$TB" ] && echo 1 || echo 0 )`,
  ].join("; ")

  try {
    const { stdout, stderr, code } = await sshExec(cmd, creds)
    if (code !== 0 && !stdout.includes("REPO:")) {
      return {
        configured: true,
        ludushoundPath,
        repoPresent: false,
        binaryPresent: false,
        goAvailable: false,
        collectionTarballPresent: false,
        collectionTarballPath: tarball,
        error: stderr || `probe exit ${code}`,
      }
    }
    const flag = (key: string) => new RegExp(`${key}:(\\d)`).exec(stdout)?.[1] === "1"
    return {
      configured: true,
      ludushoundPath,
      repoPresent: flag("REPO"),
      binaryPresent: flag("BIN"),
      goAvailable: flag("GO"),
      collectionTarballPresent: flag("TB"),
      collectionTarballPath: tarball,
    }
  } catch (err) {
    return {
      configured: true,
      ludushoundPath,
      repoPresent: false,
      binaryPresent: false,
      goAvailable: false,
      collectionTarballPresent: false,
      collectionTarballPath: tarball,
      error: (err as Error).message,
    }
  }
}

/**
 * Clone (or fast-forward pull) LudusHound on the Ludus host under LUDUSHOUND_PATH.
 * Runs as root SSH (undefined creds) so `/opt/...` is writable.
 */
export async function cloneLudushoundRepo(opts?: {
  creds?: SSHCreds
  /** Force root SSH even when user creds exist (default true for /opt installs). */
  asRoot?: boolean
}): Promise<{ ok: boolean; detail: string; stdout: string; stderr: string }> {
  const root = resolveLudushoundPath()
  const asRoot = opts?.asRoot !== false
  const creds = asRoot ? undefined : opts?.creds

  const cmd = [
    `command -v git >/dev/null 2>&1 || { echo 'git not found on Ludus host'; exit 3; }`,
    `ROOT=${shellQuote(safePath(root))}`,
    `URL=${shellQuote(LUDUSHOUND_GIT_URL)}`,
    `PARENT=$(dirname "$ROOT")`,
    `mkdir -p "$PARENT"`,
    `if [ -d "$ROOT/.git" ]; then`,
    `  git -C "$ROOT" pull --ff-only`,
    `  echo CLONE_OK pull`,
    `elif [ -e "$ROOT" ] && [ "$(ls -A "$ROOT" 2>/dev/null | wc -l)" -gt 0 ]; then`,
    `  echo "Path $ROOT exists and is not an empty LudusHound git clone. Move/remove it, or set LUDUSHOUND_PATH."`,
    `  exit 4`,
    `else`,
    `  rm -rf "$ROOT"`,
    `  git clone "$URL" "$ROOT"`,
    `  echo CLONE_OK clone`,
    `fi`,
    `test -d "$ROOT/.git" && test -d "$ROOT/Collections"`,
  ].join("\n")

  try {
    const { stdout, stderr, code } = await sshExec(cmd, creds)
    if (code !== 0 || !stdout.includes("CLONE_OK")) {
      return {
        ok: false,
        detail: stderr || stdout || `git clone/pull failed (exit ${code})`,
        stdout,
        stderr,
      }
    }
    const action = stdout.includes("CLONE_OK pull") ? "updated (git pull)" : "cloned"
    return {
      ok: true,
      detail: `LudusHound ${action} at ${root}`,
      stdout,
      stderr,
    }
  } catch (err) {
    return {
      ok: false,
      detail: (err as Error).message,
      stdout: "",
      stderr: (err as Error).message,
    }
  }
}

/**
 * Install official Go toolchain under /usr/local/go on the Ludus host (root SSH).
 * Idempotent when `go` is already on PATH (including /usr/local/go/bin).
 */
export async function installGoToolchain(opts?: {
  version?: string
}): Promise<{ ok: boolean; detail: string; stdout: string; stderr: string }> {
  const version = (opts?.version || LUDUSHOUND_GO_VERSION).replace(/[^0-9.]/g, "")
  if (!version) {
    return { ok: false, detail: "Invalid Go version", stdout: "", stderr: "" }
  }

  const cmd = [
    `export PATH="/usr/local/go/bin:$PATH"`,
    `if command -v go >/dev/null 2>&1; then echo "GO_OK already $(go version)"; exit 0; fi`,
    `ARCH=$(uname -m)`,
    `case "$ARCH" in`,
    `  x86_64|amd64) GOARCH=amd64 ;;`,
    `  aarch64|arm64) GOARCH=arm64 ;;`,
    `  *) echo "Unsupported arch: $ARCH"; exit 3 ;;`,
    `esac`,
    `URL="https://go.dev/dl/go${version}.linux-$GOARCH.tar.gz"`,
    `command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || { echo 'curl or wget required'; exit 4; }`,
    `TMP=$(mktemp /tmp/go-XXXXXX.tar.gz)`,
    `if command -v curl >/dev/null 2>&1; then curl -fsSL "$URL" -o "$TMP"; else wget -qO "$TMP" "$URL"; fi`,
    `rm -rf /usr/local/go`,
    `tar -C /usr/local -xzf "$TMP"`,
    `rm -f "$TMP"`,
    `ln -sfn /usr/local/go/bin/go /usr/local/bin/go`,
    `ln -sfn /usr/local/go/bin/gofmt /usr/local/bin/gofmt`,
    `export PATH="/usr/local/go/bin:$PATH"`,
    `command -v go >/dev/null 2>&1 || { echo 'go still missing after install'; exit 5; }`,
    `echo "GO_OK installed $(go version)"`,
  ].join("\n")

  try {
    const { stdout, stderr, code } = await sshExec(cmd, undefined)
    if (code !== 0 || !stdout.includes("GO_OK")) {
      return {
        ok: false,
        detail: stderr || stdout || `Go install failed (exit ${code})`,
        stdout,
        stderr,
      }
    }
    const line = stdout.split("\n").find((l) => l.includes("GO_OK")) || "GO_OK"
    return { ok: true, detail: line.replace(/^GO_OK\s*/, "").trim() || `Go ${version} ready`, stdout, stderr }
  } catch (err) {
    return {
      ok: false,
      detail: (err as Error).message,
      stdout: "",
      stderr: (err as Error).message,
    }
  }
}

/**
 * Ensure Go is on the Ludus host (install official tarball under /usr/local if missing).
 * Uses root SSH.
 */
export async function ensureGoToolchain(): Promise<{ ok: boolean; detail: string }> {
  const probe = await probeLudushoundHost(undefined)
  if (probe.goAvailable) {
    return { ok: true, detail: "Go already available" }
  }
  const installed = await installGoToolchain()
  return { ok: installed.ok, detail: installed.detail }
}

/** Build LudusHound binary on the Ludus host when missing. Installs Go if needed. */
export async function buildLudushoundBinary(
  creds?: SSHCreds,
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  const go = await ensureGoToolchain()
  if (!go.ok) {
    return {
      ok: false,
      stdout: "",
      stderr: go.detail,
      error: go.detail || "Go toolchain not found on Ludus host; cannot build LudusHound binary.",
    }
  }

  const root = resolveLudushoundPath()
  // Root SSH for /opt write; PATH includes /usr/local/go/bin after LUX install.
  const runCreds = creds ?? undefined
  const cmd = [
    `export PATH="/usr/local/go/bin:$PATH"`,
    `cd ${shellQuote(root)} || exit 2`,
    `command -v go >/dev/null 2>&1 || { echo 'go toolchain not found on Ludus host'; exit 3; }`,
    `go mod init LudusHound 2>/dev/null || true`,
    `go get gopkg.in/yaml.v3`,
    `go mod tidy`,
    `go build -o LudusHound .`,
    `test -x ./LudusHound && echo BUILD_OK`,
  ].join(" && ")

  const { stdout, stderr, code } = await sshExec(cmd, runCreds)
  if (code !== 0 || !stdout.includes("BUILD_OK")) {
    return {
      ok: false,
      stdout,
      stderr,
      error: stderr || stdout || `go build failed (exit ${code})`,
    }
  }
  return { ok: true, stdout, stderr }
}

export async function ensureLudushoundWorkspace(
  workspaceId: string,
  creds?: SSHCreds,
): Promise<string> {
  const root = resolveLudushoundPath()
  const safeId = workspaceId.replace(/[^a-zA-Z0-9._-]/g, "")
  const dir = `${root}/workspaces/${safeId}`
  await sshExec(`mkdir -p ${shellQuote(dir)}/uploads ${shellQuote(dir)}/out`, creds)
  return dir
}

export async function writeLudushoundRangeId(
  workspaceId: string,
  rangeId: string,
  creds?: SSHCreds,
): Promise<void> {
  const root = resolveLudushoundPath()
  const safeId = workspaceId.replace(/[^a-zA-Z0-9._-]/g, "")
  const file = `${root}/workspaces/${safeId}/.ludushound_range_id`
  await sshExec(
    `mkdir -p ${shellQuote(`${root}/workspaces/${safeId}`)} && printf '%s' ${shellQuote(rangeId)} > ${shellQuote(file)}`,
    creds,
  )
}

export async function writeRemoteTextFile(
  remotePath: string,
  content: string,
  creds?: SSHCreds,
): Promise<void> {
  const b64 = Buffer.from(content, "utf8").toString("base64")
  const dir = remotePath.includes("/") ? remotePath.slice(0, remotePath.lastIndexOf("/")) : "."
  const cmd = [
    `mkdir -p ${shellQuote(dir)}`,
    `echo ${shellQuote(b64)} | base64 -d > ${shellQuote(remotePath)}`,
  ].join(" && ")
  const { code, stderr } = await sshExec(cmd, creds)
  if (code !== 0) throw new Error(stderr || `Failed to write ${remotePath}`)
}

export async function readRemoteTextFile(
  remotePath: string,
  creds?: SSHCreds,
): Promise<string> {
  const { stdout, stderr, code } = await sshExec(
    `cat ${shellQuote(remotePath)} 2>/dev/null || true`,
    creds,
  )
  if (code !== 0) throw new Error(stderr || `Failed to read ${remotePath}`)
  return stdout
}

export async function runLudushoundGenerate(
  args: LudushoundGenerateArgs,
  creds?: SSHCreds,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  const root = resolveLudushoundPath()
  const cmd = buildLudushoundCommand(root, args)
  const result = await sshExec(cmd, creds)
  return {
    ok: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
  }
}

/** Probe Neo4j HTTP transactional endpoint from the Ludus host. */
export async function probeNeo4jFromHost(
  server: string,
  user: string,
  pass: string,
  creds?: SSHCreds,
): Promise<{ ok: boolean; detail: string }> {
  const host = server.replace(/['"\\\s]/g, "")
  const url = `http://${host}:7474/db/neo4j/tx/commit`
  const body = JSON.stringify({
    statements: [{ statement: "MATCH (n:Domain) RETURN n.name AS name LIMIT 5" }],
  })
  const b64 = Buffer.from(body, "utf8").toString("base64")
  const auth = Buffer.from(`${user}:${pass}`, "utf8").toString("base64")
  const cmd = [
    `BODY=$(echo ${shellQuote(b64)} | base64 -d)`,
    `curl -sS -m 15 -o /tmp/lux-lh-neo4j.json -w '%{http_code}' ` +
      `-H 'Content-Type: application/json' ` +
      `-H ${shellQuote(`Authorization: Basic ${auth}`)} ` +
      `-d "$BODY" ${shellQuote(url)}`,
  ].join("; ")

  try {
    const { stdout, stderr, code } = await sshExec(cmd, creds)
    const httpCode = stdout.trim().slice(-3)
    const ok = code === 0 && (httpCode === "200" || httpCode === "201")
    const detail = ok
      ? `Neo4j OK (HTTP ${httpCode})`
      : `Neo4j probe failed (HTTP ${httpCode || "?"}): ${stderr || stdout}`
    return { ok, detail }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

export async function listLudushoundWorkspaces(creds?: SSHCreds): Promise<
  Array<{ id: string; rangeId?: string; mtime?: string }>
> {
  const root = resolveLudushoundPath()
  const cmd = [
    `W=${shellQuote(`${root}/workspaces`)}`,
    `if [ ! -d "$W" ]; then exit 0; fi`,
    `for d in "$W"/*/; do`,
    `  [ -d "$d" ] || continue`,
    `  id=$(basename "$d")`,
    `  rid=""`,
    `  [ -f "$d/.ludushound_range_id" ] && rid=$(cat "$d/.ludushound_range_id" 2>/dev/null)`,
    `  mt=$(stat -c %Y "$d" 2>/dev/null || stat -f %m "$d" 2>/dev/null || echo 0)`,
    `  echo "$id|$rid|$mt"`,
    `done`,
  ].join("\n")

  const { stdout } = await sshExec(cmd, creds)
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, rangeId, mtime] = line.split("|")
      return {
        id,
        rangeId: rangeId || undefined,
        mtime: mtime || undefined,
      }
    })
}
