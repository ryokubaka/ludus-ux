#!/usr/bin/env node
/**
 * Seed DATA_DIR/docs-cache/ludus from curated https://docs.ludus.cloud/docs/* pages.
 * Usage (from repo root, with Node):
 *   DATA_DIR=./data node --import tsx scripts/seed-ludus-docs.ts
 * Or inside the ludus-ux container after rebuild (if ts is compiled into dist — prefer API):
 *   Prefer: enable assistant and send a chat (auto-seeds), or POST /api/assistant/docs/seed as admin.
 */

import { seedLudusDocsCache, docsCorpusStats } from "../src/lib/assistant/docs-corpus"

async function main() {
  const force = process.argv.includes("--force")
  console.log("Seeding Ludus docs cache…", { force, dataDir: process.env.DATA_DIR || "./data" })
  const result = await seedLudusDocsCache({ force })
  console.log(JSON.stringify({ ...result, corpus: docsCorpusStats() }, null, 2))
  if (result.errors.length) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
