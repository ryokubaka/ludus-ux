/**
 * Keeps secrets out of process arguments. A command string sent over SSH runs
 * as `bash -c '<command>'` on the Ludus host, and any local user can read that
 * argv with `ps`. Secrets go on stdin or into a 0600 file instead. Lines that
 * look like a secret in a command but are actually sent on stdin are listed
 * below with the reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

/** A template literal that reads as a shell command. */
const SHELL_WORDS =
  /\b(curl|wget|sshpass|ludus|mysql|psql|export|echo|printf|sudo|ansible-\w+|python3?|bash|sh)\b|--password|--token|[\s`'"]-[Hu]\s|\b[A-Z][A-Z0-9_]*=['"]?\$\{/
/** An interpolated value named like a secret. */
const SECRET_INTERP = /\$\{[^}]*(api_?key|password|passwd|\bpass\b|secret|token|\bauth\b|ticket)[^}]*\}/i

/** `file: line fragment` → why it is not an argv leak. */
const SENT_ON_STDIN: Record<string, string> = {
  "src/lib/auth-ssh.ts: export LUDUS_API_KEY=${apiKey}":
    "The ~/.bashrc snippet is written by `cat >> ~/.bashrc` from stdin.",
  "src/lib/goad-ssh.ts: LUDUS_API_KEY='${ludusApiKey":
    "GOAD's environment is written from stdin to a 0600 file (goad-ssh-secrets.test.ts).",
}

/** Shell lines that pass a secret as an argument. */
const SHELL_ARGV_SECRET = [
  /\bsshpass\s+-p\b/,
  /\bcurl\b.*\s-u\s+["']?\$/,
  /\bcurl\b.*-H\s+["'][^"']*(Authorization|X-API-KEY|Token|Cookie)[^"']*\$/i,
  /--password[= ]["']?\$/,
  /\bmysql\b.*\s-p["']?\$/,
  /\benv\s[^#]*?\b[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*=/,
]

function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, keep))
    else if (keep(full)) out.push(full)
  }
  return out
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/")
const isSource = (file: string) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)
const isShell = (file: string) => /\.sh$/.test(file) || path.basename(file) === "lux-host"

/** Whole-line check, so nested templates like `-H ${q(`Authorization: ${auth}`)}` still match. */
function isShellSecretLine(line: string): boolean {
  return !/^\s*(\/\/|\*)/.test(line) && line.includes("`") && SECRET_INTERP.test(line) && SHELL_WORDS.test(line)
}

function tsFindings(): string[] {
  const files = ["src/lib", "src/app/api", "server"].flatMap((dir) => walk(path.join(ROOT, dir), isSource))
  const findings: string[] = []
  for (const file of files) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (!isShellSecretLine(line)) return
      const allowed = Object.keys(SENT_ON_STDIN).some((key) => {
        const [keyFile, fragment] = key.split(": ")
        return keyFile === rel(file) && line.includes(fragment)
      })
      if (!allowed) findings.push(`${rel(file)}:${i + 1}: ${line.trim()}`)
    })
  }
  return findings
}

function shellFindings(): string[] {
  const files = ["scripts", "docker"].flatMap((dir) => walk(path.join(ROOT, dir), isShell))
  const findings: string[] = []
  for (const file of files) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (/^\s*#/.test(line)) return
      if (SHELL_ARGV_SECRET.some((re) => re.test(line))) findings.push(`${rel(file)}:${i + 1}: ${line.trim()}`)
    })
  }
  return findings
}

describe("secrets stay out of process arguments", () => {
  it("builds no shell command that interpolates a secret", () => {
    expect(tsFindings(), "send the secret on stdin, or list it in SENT_ON_STDIN with the reason").toEqual([])
  })

  it("passes no secret as a shell argument in the bundled scripts", () => {
    expect(shellFindings(), "use stdin, `curl -H @-`, `sshpass -e`, or an env var").toEqual([])
  })

  it("keeps the stdin list current", () => {
    const stale = Object.keys(SENT_ON_STDIN).filter((key) => {
      const [keyFile, fragment] = key.split(": ")
      return !readFileSync(path.join(ROOT, keyFile), "utf8").includes(fragment)
    })
    expect(stale).toEqual([])
  })

  it("catches the Neo4j probe header the way it used to be built", () => {
    expect(isShellSecretLine("      `-H ${shellQuote(`Authorization: Basic ${auth}`)} ` +")).toBe(true)
  })

  it("catches the shell forms the reviewer found", () => {
    expect(SHELL_ARGV_SECRET.some((re) => re.test(`curl -sS -H "X-API-KEY: $key" "$url"`))).toBe(true)
    expect(SHELL_ARGV_SECRET.some((re) => re.test(`sshpass -p "$pw" ssh root@host`))).toBe(true)
    expect(SHELL_ARGV_SECRET.some((re) => re.test(`env LUDUS_API_KEY="$key" ludus templates add -d x`))).toBe(true)
    expect(SHELL_ARGV_SECRET.some((re) => re.test(`env LUDUS_VERSION=2 LUDUS_API_KEY="$key" ludus templates add`))).toBe(true)
    expect(SHELL_ARGV_SECRET.some((re) => re.test(`SSHPASS="$pw" sshpass -e ssh root@host`))).toBe(false)
    expect(SHELL_ARGV_SECRET.some((re) => re.test(`LUDUS_API_KEY="$key" ludus templates add -d x`))).toBe(false)
  })
})
