#!/usr/bin/env node
// Lints CHANGELOG.md. Every release: one known tag per bullet, no repeated
// bullet. The newest release also needs tags in the documented order within
// each **Group**, unique titles, no bullet copied from an older release, and
// a version that matches package.json, APP_VERSION, the README badge, and the
// OpenAPI version.

import { readFileSync } from "node:fs"

const TAGS = ["Breaking", "Security", "Add", "Fix", "Improve", "Perf", "Remove", "Docs"]
const problems = []
const read = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n")

const releases = []
let current = null
read("CHANGELOG.md")
  .split("\n")
  .forEach((line, i) => {
    const header = /^## \[(\d+\.\d+\.\d+)\](?: [-—] (\d{4}-\d{2}-\d{2}))?\s*$/.exec(line)
    if (header) {
      current = { version: header[1], date: header[2], line: i + 1, bullets: [] }
      releases.push(current)
      return
    }
    if (/^## /.test(line)) {
      if (!/^## Unreleased\s*$/.test(line)) problems.push(`CHANGELOG.md:${i + 1}: header must be "## [X.Y.Z] - YYYY-MM-DD" or "## Unreleased"`)
      current = null
      return
    }
    if (!current) return
    const group = /^\*\*(.+)\*\*\s*$/.exec(line)
    if (group) {
      current.group = group[1]
      return
    }
    if (/^- /.test(line)) current.bullets.push({ text: line, line: i + 1, group: current.group ?? "" })
  })

if (releases.length === 0) problems.push("CHANGELOG.md: no release headers")

const semver = (v) => v.split(".").map(Number)
const newer = (a, b) => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

const seenVersions = new Set()
releases.forEach((release, index) => {
  if (seenVersions.has(release.version)) problems.push(`CHANGELOG.md:${release.line}: ${release.version} appears twice`)
  seenVersions.add(release.version)
  const next = releases[index + 1]
  if (next && !newer(release.version, next.version)) {
    problems.push(`CHANGELOG.md:${release.line}: ${release.version} is listed above ${next.version}; newest first`)
  }
  if (!release.date) problems.push(`CHANGELOG.md:${release.line}: ${release.version} has no date`)

  const strict = index === 0
  const titles = new Map()
  // Older releases predate the "[Tag] **Title** —" format and stay as written.
  const texts = new Set()
  let lastGroup = null
  let lastTag = -1
  for (const bullet of release.bullets) {
    const at = `CHANGELOG.md:${bullet.line}`
    const tags = [...bullet.text.matchAll(/\[(\w+)\]/g)].map((m) => m[1]).filter((t) => !/^\d/.test(t))
    const m = /^- \[(\w+)\] (?:\*\*(.+?)\*\*)?/.exec(bullet.text)
    if (!m || (strict && !m[2])) {
      problems.push(`${at}: bullet must start with ${strict ? '"- [Tag] **Title**"' : '"- [Tag]"'}`)
      continue
    }
    const [, tag, title] = m
    if (!TAGS.includes(tag)) problems.push(`${at}: unknown tag [${tag}] (use ${TAGS.join(", ")})`)
    if (tags.filter((t) => TAGS.includes(t)).length > 1) problems.push(`${at}: more than one tag`)
    if (texts.has(bullet.text)) problems.push(`${at}: repeats an earlier bullet in ${release.version}`)
    texts.add(bullet.text)
    if (!strict) continue

    if (bullet.group !== lastGroup) {
      lastGroup = bullet.group
      lastTag = -1
    }
    const order = TAGS.indexOf(tag)
    if (order < lastTag) problems.push(`${at}: [${tag}] comes after [${TAGS[lastTag]}]; order is ${TAGS.join(", ")}`)
    lastTag = Math.max(lastTag, order)

    const key = `${bullet.group}\0${title.toLowerCase()}`
    if (titles.has(key)) problems.push(`${at}: title "${title}" is already used on line ${titles.get(key)}`)
    titles.set(key, bullet.line)
  }
})

if (releases.length > 0) {
  const newest = releases[0]
  const older = new Set(releases.slice(1).flatMap((r) => r.bullets.map((b) => b.text)))
  for (const bullet of newest.bullets) {
    if (older.has(bullet.text)) problems.push(`CHANGELOG.md:${bullet.line}: copied from an older release`)
  }

  const versions = {
    "package.json": JSON.parse(read("package.json")).version,
    "src/lib/changelog.ts": /APP_VERSION\s*=\s*"([^"]+)"/.exec(read("src/lib/changelog.ts"))?.[1],
    "README.md badge": /badge\/version-([\d.]+)-/.exec(read("README.md"))?.[1],
    "docs/openapi.yaml": /^\s+version:\s*"?([\d.]+)"?\s*$/m.exec(read("docs/openapi.yaml"))?.[1],
  }
  for (const [where, version] of Object.entries(versions)) {
    if (version !== newest.version) problems.push(`${where}: version ${version ?? "(missing)"} does not match CHANGELOG ${newest.version}`)
  }
}

if (problems.length > 0) {
  console.error(`Changelog: ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`Changelog: ok (${releases.length} releases, newest ${releases[0].version})`)
