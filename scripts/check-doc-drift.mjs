#!/usr/bin/env node
// Fails when documentation drifts from the code it describes: a framework
// version claim that disagrees with package.json, an environment variable the
// app reads but no page documents, a docs page missing from docs/index.md, or
// a repository path a page names that does not exist.
//
// The allowlists below are the deliberate exceptions. Keep them short and next
// to the check they belong to, so an exception is visible in review.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const rootFlag = args.indexOf("--root")
const root = rootFlag >= 0 ? path.resolve(args[rootFlag + 1]) : process.cwd()

const problems = []
const fail = (at, message) => problems.push(`${at}: ${message}`)
const read = (file) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")

// --- Allowlists -------------------------------------------------------------
// Variables read by the app that are not configuration: set by Node, Next, the
// Docker CLI, or the CI runner.
const ENV_INTERNAL = new Set([
  "NODE_ENV",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NEXT_PHASE",
  "NEXT_RUNTIME",
  "HOME",
  "PATH",
  "DOCKER_HOST",
  "LUX_TEST_REQUIRE_CAPS",
])

// Paths a page names that are created on the host at install time, not shipped.
const PATH_RUNTIME = new Set([
  "docker/nginx/certificates/cert.pem",
  "docker/nginx/certificates/key.pem",
])

// --- Helpers ----------------------------------------------------------------
function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, filter, out)
    else if (filter(entry.name)) out.push(full)
  }
  return out
}

const rel = (file) => path.relative(root, file).replace(/\\/g, "/")

// Release plans are local working notes (gitignored). They quote the versions
// they are changing, so they are not product documentation and are skipped.
const isPlan = (file) => rel(file).startsWith("docs/plans/")

const productDocs = () =>
  existsSync(path.join(root, "docs"))
    ? walk(path.join(root, "docs"), (name) => name.endsWith(".md")).filter((file) => !isPlan(file))
    : []

const markdown = () => [
  ...productDocs(),
  ...(existsSync(path.join(root, "README.md")) ? [path.join(root, "README.md")] : []),
]

function majorOf(pkg) {
  const version = read("package.json").match(new RegExp(`"${pkg}"\\s*:\\s*"[^"]*?(\\d+)`))
  return version?.[1]
}

// --- Framework version claims ----------------------------------------------
const VERSION_CLAIMS = [
  { label: "Next.js", pattern: /Next\.js\s+v?(\d+)/g, pkg: "next" },
  { label: "React", pattern: /\bReact\s+v?(\d+)/g, pkg: "react" },
  { label: "Tailwind", pattern: /\bTailwind(?:\s+CSS)?\s+v?(\d+)/g, pkg: "tailwindcss" },
]

for (const file of markdown()) {
  const lines = read(rel(file)).split("\n")
  lines.forEach((line, i) => {
    for (const claim of VERSION_CLAIMS) {
      const actual = majorOf(claim.pkg)
      if (!actual) continue
      for (const match of line.matchAll(claim.pattern)) {
        if (match[1] !== actual) {
          fail(`${rel(file)}:${i + 1}`, `${claim.label} ${match[1]} disagrees with ${claim.pkg} ${actual} in package.json`)
        }
      }
    }
  })
}

// --- Environment variables --------------------------------------------------
const documented = [
  existsSync(path.join(root, ".env.example")) ? read(".env.example") : "",
  ...productDocs().map((file) => read(rel(file))),
].join("\n")

const appSources = [
  ...(existsSync(path.join(root, "src"))
    ? walk(path.join(root, "src"), (name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name))
    : []),
  ...(existsSync(path.join(root, "server")) ? walk(path.join(root, "server"), (name) => /\.(ts|tsx)$/.test(name)) : []),
]

const envRead = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g
const seenEnv = new Map()
for (const file of appSources) {
  const lines = read(rel(file)).split("\n")
  lines.forEach((line, i) => {
    for (const match of line.matchAll(envRead)) {
      const name = match[1] ?? match[2]
      if (!seenEnv.has(name)) seenEnv.set(name, `${rel(file)}:${i + 1}`)
    }
  })
}

for (const [name, at] of seenEnv) {
  if (ENV_INTERNAL.has(name)) continue
  if (!new RegExp(`\\b${name}\\b`).test(documented)) {
    fail(at, `process.env.${name} is not documented in .env.example or docs/`)
  }
}

// --- Docs index -------------------------------------------------------------
if (existsSync(path.join(root, "docs/index.md"))) {
  const index = read("docs/index.md")
  const listed = new Set()
  for (const match of index.matchAll(/\]\(([^)\s]+)\)/g)) {
    listed.add(match[1].replace(/^\.\//, "").split("#")[0])
  }
  for (const match of index.matchAll(/`([^`]+\.(?:md|yaml))`/g)) {
    listed.add(match[1].replace(/^\.\//, ""))
  }

  const pages = productDocs()
    .map((file) => path.relative(path.join(root, "docs"), file).replace(/\\/g, "/"))
    .filter((page) => page !== "index.md")

  for (const page of pages) {
    if (!listed.has(page)) fail("docs/index.md", `does not list docs/${page}`)
  }
  for (const target of listed) {
    if (/^[a-z]+:/i.test(target)) continue
    if (!existsSync(path.join(root, "docs", target))) fail("docs/index.md", `links to missing docs/${target}`)
  }
}

// --- Repository paths named in pages ---------------------------------------
const PATH_PREFIX = /^(src|scripts|config|docker|docs|e2e|server)\//
for (const file of markdown()) {
  const lines = read(rel(file)).split("\n")
  lines.forEach((line, i) => {
    for (const match of line.matchAll(/`([^`\s]+)`/g)) {
      const raw = match[1]
      if (!PATH_PREFIX.test(raw)) continue
      if (/[<>{*:]/.test(raw)) continue
      const candidate = raw.replace(/\/\.\.\.$/, "").replace(/\/$/, "")
      if (PATH_RUNTIME.has(candidate)) continue
      if (!existsSync(path.join(root, candidate))) {
        fail(`${rel(file)}:${i + 1}`, `path ${raw} does not exist`)
      }
    }
  })
}

// --- Result -----------------------------------------------------------------
if (problems.length > 0) {
  console.error(`Doc drift: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`Doc drift: ok (${markdown().length} pages, ${seenEnv.size} env names)`)
