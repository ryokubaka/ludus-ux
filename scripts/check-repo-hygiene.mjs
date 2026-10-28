#!/usr/bin/env node
// Fails on repo mistakes that tests do not see: a committed symlink to a home
// directory, lockfile links into node_modules, tracked secrets files, and lab
// hostnames, IPs, or passwords in CI and e2e files (both repos are synced, one
// of them public).
//
// Values to refuse in the tracked tree (the lab host, the admin password) come
// from the environment or a gitignored .security-gate.env, never from this file.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
process.chdir(root)

const problems = []
const fail = (msg) => problems.push(msg)
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const tracked = git("ls-files", "-z").split("\0").filter(Boolean)

// --- Symlinks -------------------------------------------------------------
for (const line of git("ls-files", "-s", "-z").split("\0").filter(Boolean)) {
  const [meta, file] = line.split("\t")
  const [mode, sha] = meta.split(" ")
  if (mode !== "120000") continue
  const target = git("cat-file", "-p", sha).trim()
  const resolved = path.resolve(root, path.dirname(file), target)
  if (path.basename(file) === "node_modules") fail(`${file}: node_modules is committed as a symlink (to ${target})`)
  else if (path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target) || !resolved.startsWith(root + path.sep)) {
    fail(`${file}: symlink points outside the repo (${target})`)
  }
}

// --- Lockfile ---------------------------------------------------------------
if (existsSync("package-lock.json")) {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"))
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    const resolved = typeof entry.resolved === "string" ? entry.resolved.replace(/^file:/, "") : ""
    if (!resolved) continue
    const absolute = path.isAbsolute(resolved) || /^[A-Za-z]:[\\/]/.test(resolved) || resolved.startsWith("~")
    if (absolute) fail(`package-lock.json ${name}: resolved to an absolute path (${entry.resolved})`)
    if (entry.link && /(^|\/)node_modules\//.test(resolved)) {
      fail(`package-lock.json ${name}: links into node_modules (${entry.resolved}); depend on the file: path directly`)
    }
  }
}

// --- Secrets files ----------------------------------------------------------
const SECRET_FILE = [
  /(^|\/)\.env(\.[^/]+)?$/,
  /\.env$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /(^|\/)\.security-gate\.env$/,
]
const SECRET_FILE_OK = [/(^|\/)\.env\.example$/, /(^|\/)\.security-gate\.env\.example$/]
for (const file of tracked) {
  if (SECRET_FILE.some((re) => re.test(file)) && !SECRET_FILE_OK.some((re) => re.test(file))) {
    fail(`${file}: secrets file is tracked`)
  }
}

// --- Deployment details in CI and e2e files ---------------------------------
const SCANNED = (file) =>
  file === ".gitlab-ci.yml" ||
  file.startsWith(".github/workflows/") ||
  file.startsWith(".gitlab/") ||
  file.startsWith("e2e/") ||
  file.startsWith("scripts/ci/") ||
  file === "config/playwright.config.ts"

const PUBLIC_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "github.com",
  "api.github.com",
  "github.blog",
  "docs.github.com",
  "gitlab.com",
  "docs.gitlab.com",
  "registry.npmjs.org",
  "nodejs.org",
  "ghcr.io",
  "docker.io",
  "gcr.io",
  "semgrep.dev",
])
// RFC 2606 / 6761 reserved names.
const TEST_HOST = /(^|\.)(example(\.(com|org|net))?|test|invalid|localhost)$/
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g
const SAFE_IP = (a, b, c) =>
  a === "127" ||
  a === "0" ||
  (a === "192" && b === "0" && c === "2") ||
  (a === "198" && b === "51" && c === "100") ||
  (a === "203" && b === "0" && c === "113")
const INTERNAL_TLD = /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(mil|lan|local|internal|corp|intra|home|lab)\b/i
// A password or token literal, rather than a reference to a variable.
const CREDENTIAL_LITERAL =
  /(password|passwd|token|api[_-]?key|secret)\w*["']?\s*(:|=|\?\?|\|\|)\s*["'](?![$]|\s*["'])[^"'\s]{3,}["']/i
// An unquoted env or YAML assignment of a literal to a password, token, secret, or API key name.
const CREDENTIAL_ASSIGNMENT =
  /^\s*(?:export\s+|-\s+)?[A-Z0-9_]*(PASSWORD|TOKEN|SECRET|API_KEY)[A-Z0-9_]*\s*[=:]\s*(?![$<"'{\s]|$)\S{3,}/

for (const file of tracked.filter(SCANNED)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/)
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`
    for (const m of line.matchAll(/https?:\/\/([^/\s"'`)<>:]+)/g)) {
      const host = m[1].toLowerCase()
      // Variables, and regex or shell text that only looks like a URL.
      if (!/^[a-z0-9.-]+$/.test(host)) continue
      if (!PUBLIC_HOSTS.has(host) && !TEST_HOST.test(host) && !/^\d/.test(host)) fail(`${at}: host ${host} (use a variable)`)
    }
    for (const m of line.matchAll(IPV4)) {
      if (m.slice(1).some((part) => Number(part) > 255)) continue
      if (!SAFE_IP(m[1], m[2], m[3])) fail(`${at}: IP ${m[0]} (use a variable, or 192.0.2.x for examples)`)
    }
    const internal = INTERNAL_TLD.exec(line)
    if (internal) fail(`${at}: internal hostname ${internal[0]}`)
    if (CREDENTIAL_LITERAL.test(line) || CREDENTIAL_ASSIGNMENT.test(line)) {
      fail(`${at}: credential literal (read it from the environment)`)
    }
  })
}

// --- Values only this deployment knows ---------------------------------------
// Hosts and LUX_HYGIENE_DENY values count anywhere. The admin password counts
// only next to a credential word, because a lab password can also be an
// ordinary username in test fixtures.
const denyAnywhere = new Set()
const denyAsCredential = new Set()
const addValues = (set, raw) => {
  for (const v of String(raw ?? "").split(",")) if (v.trim().length >= 4) set.add(v.trim())
}
addValues(denyAnywhere, process.env.LUX_HYGIENE_DENY)
addValues(denyAsCredential, process.env.E2E_ADMIN_PASSWORD)
addValues(denyAnywhere, safeHost(process.env.PLAYWRIGHT_BASE_URL))
if (existsSync(".security-gate.env")) {
  for (const line of readFileSync(".security-gate.env", "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(E2E_ADMIN_PASSWORD|PLAYWRIGHT_BASE_URL|LUX_HYGIENE_DENY)=["']?(.*?)["']?\s*$/.exec(line)
    if (!m) continue
    if (m[1] === "E2E_ADMIN_PASSWORD") addValues(denyAsCredential, m[2])
    else if (m[1] === "PLAYWRIGHT_BASE_URL") addValues(denyAnywhere, safeHost(m[2]))
    else addValues(denyAnywhere, m[2])
  }
}
denyAnywhere.delete("localhost")
denyAnywhere.delete("127.0.0.1")

const grepLines = (value, ...flags) => {
  try {
    return git("grep", "-I", "-n", "-F", ...flags, "-e", value, "--", ".", ":!package-lock.json").split("\n").filter(Boolean)
  } catch {
    return [] // git grep exits 1 when nothing matches.
  }
}
const where = (hit) => hit.split(":").slice(0, 2).join(":")
for (const value of denyAnywhere) {
  for (const hit of grepLines(value)) fail(`${where(hit)}: deployment value (not shown)`)
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
for (const value of denyAsCredential) {
  const v = escapeRe(value)
  // `PASSWORD=value`, `password: "value"`, `-p value`, `user:value@host`, `user:value`.
  const asCredential = new RegExp(
    `(pass\\w*|pwd|secret|token)["']?\\s*[:=]\\s*["']?${v}\\b|\\s-p\\s*["']?${v}\\b|\\w:${v}(@|["'\\s]|$)`,
    "i",
  )
  for (const hit of grepLines(value, "-w")) {
    if (asCredential.test(hit.split(":").slice(2).join(":"))) fail(`${where(hit)}: admin password (not shown)`)
  }
}

function safeHost(url) {
  if (!url) return ""
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

if (problems.length > 0) {
  console.error(`Repo hygiene: ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
const denied = denyAnywhere.size + denyAsCredential.size
console.log(`Repo hygiene: ok (${tracked.length} tracked files${denied ? `, ${denied} deployment values` : ""})`)
