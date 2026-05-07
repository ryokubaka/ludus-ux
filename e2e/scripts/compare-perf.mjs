#!/usr/bin/env node
/**
 * Compare two perf-metrics.json attachments (saved from Playwright report or stdout).
 *
 *   node e2e/scripts/compare-perf.mjs before.json after.json
 */

import fs from "node:fs"

const [, , aPath, bPath] = process.argv
if (!aPath || !bPath) {
  console.error("Usage: node e2e/scripts/compare-perf.mjs <before.json> <after.json>")
  process.exit(1)
}

const A = JSON.parse(fs.readFileSync(aPath, "utf8"))
const B = JSON.parse(fs.readFileSync(bPath, "utf8"))

const scenariosA = Array.isArray(A.scenarios) ? A.scenarios : []
const scenariosB = Array.isArray(B.scenarios) ? B.scenarios : []

console.log("scenario | bucket | before_count | after_count | before_maxMs | after_maxMs")
console.log("---------|--------|--------------|-------------|--------------|------------")

for (const sb of scenariosB) {
  const sa = scenariosA.find((x) => x.label === sb.label)
  const keys = new Set([...Object.keys(sa?.counts ?? {}), ...Object.keys(sb.counts ?? {})])
  for (const k of [...keys].sort()) {
    const ca = sa?.counts?.[k] ?? 0
    const cb = sb.counts?.[k] ?? 0
    const ma = sa?.maxMs?.[k] ?? 0
    const mb = sb.maxMs?.[k] ?? 0
    console.log(`${sb.label} | ${k} | ${ca} | ${cb} | ${ma} | ${mb}`)
  }
  const na = sa?.navigation
  const nb = sb.navigation
  if (na || nb) {
    console.log(
      `${sb.label} | nav.duration | — | — | ${na?.duration ?? "—"} | ${nb?.duration ?? "—"}`,
    )
  }
}
