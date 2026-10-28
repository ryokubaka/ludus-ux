/**
 * Drop CodeQL results covered by an in-source suppression comment.
 *
 * GitHub code scanning does not read `// codeql[js/...]` comments. A comment
 * covers the next line of code, and a run of those comments immediately above
 * that line covers it too. A trailing comment on the alert line also covers it.
 * An ordinary comment between the marker and the code does not.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const FULL_LINE_COMMENT = /^\s*\/\/(.*)$/

function stripCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

export function codeqlIdsInText(text) {
  return [...stripCarriageReturn(text).matchAll(/codeql\s*\[([^\]]+)\]/gi)].map((match) =>
    match[1].trim().toLowerCase(),
  )
}

/** @param {string[]} lines @param {number} startLine 1-based alert line */
export function idsCoveringLine(lines, startLine) {
  const ids = new Set(codeqlIdsInText(lines[startLine - 1] ?? ""))
  for (let i = startLine - 2; i >= 0; i--) {
    const comment = FULL_LINE_COMMENT.exec(stripCarriageReturn(lines[i] ?? ""))
    if (!comment) break
    const found = codeqlIdsInText(comment[1])
    if (found.length === 0) break
    for (const id of found) ids.add(id)
  }
  return ids
}

function artifactUri(run, artifact) {
  if (!artifact) return null
  if (artifact.uri) return artifact.uri
  if (artifact.index != null) return run.artifacts?.[artifact.index]?.location?.uri ?? null
  return null
}

function isSuppressed(run, result, readText) {
  const ruleId = String(result.ruleId ?? "").toLowerCase()
  if (!ruleId) return false
  const physical = result.locations?.[0]?.physicalLocation
  const startLine = physical?.region?.startLine
  const uri = artifactUri(run, physical?.artifactLocation)
  if (!startLine || !uri) return false
  const text = readText(uri)
  if (text == null) return false
  return idsCoveringLine(text.split(/\r?\n/), startLine).has(ruleId)
}

/**
 * @param {object} doc SARIF document
 * @param {(uri: string) => string | null} readText
 * @returns {number} results removed
 */
export function filterSarif(doc, readText) {
  let removed = 0
  for (const run of doc.runs ?? []) {
    const kept = []
    for (const result of run.results ?? []) {
      if (isSuppressed(run, result, readText)) removed++
      else kept.push(result)
    }
    run.results = kept
  }
  return removed
}

function sourcePath(uri, root) {
  let decoded = uri
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    return null
  }
  const normalized = decoded.replace(/\\/g, "/")
  if (normalized.split("/").includes("..")) return null
  if (path.isAbsolute(normalized)) return null
  return path.join(root, normalized)
}

function sarifFiles(target) {
  const info = statSync(target)
  if (info.isFile()) return [target]
  const found = []
  for (const name of readdirSync(target)) {
    const full = path.join(target, name)
    if (statSync(full).isDirectory()) found.push(...sarifFiles(full))
    else if (name.endsWith(".sarif")) found.push(full)
  }
  return found
}

function applyFile(file, root) {
  const doc = JSON.parse(readFileSync(file, "utf8"))
  const cache = new Map()
  const removed = filterSarif(doc, (uri) => {
    if (cache.has(uri)) return cache.get(uri)
    const full = sourcePath(uri, root)
    let text = null
    if (full) {
      try {
        text = readFileSync(full, "utf8")
      } catch {
        text = null
      }
    }
    cache.set(uri, text)
    return text
  })
  writeFileSync(file, `${JSON.stringify(doc)}\n`)
  const left = (doc.runs ?? []).reduce((sum, run) => sum + (run.results?.length ?? 0), 0)
  console.log(`${path.basename(file)}: removed ${removed}, remaining ${left}`)
  return removed
}

function main() {
  const target = process.argv[2]
  if (!target) {
    console.error("usage: node scripts/ci/codeql-apply-suppressions.mjs <sarif-file-or-directory>")
    process.exit(1)
  }
  const files = sarifFiles(target)
  if (files.length === 0) {
    console.error(`No SARIF files in ${target}`)
    process.exit(1)
  }
  for (const file of files) applyFile(file, process.cwd())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
