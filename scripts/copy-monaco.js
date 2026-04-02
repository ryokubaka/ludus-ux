/**
 * Copies Monaco Editor's VS distribution files from node_modules into public/monaco-vs
 * so the editor can be served locally without any CDN dependency.
 *
 * Run automatically via `npm run dev` and `npm run build` (see package.json scripts).
 * The copy is skipped when the destination already exists to keep incremental builds fast.
 */

const fs = require("fs")
const path = require("path")

const src = path.join(__dirname, "..", "node_modules", "monaco-editor", "min", "vs")
const dest = path.join(__dirname, "..", "public", "monaco-vs")

if (!fs.existsSync(src)) {
  console.warn("[copy-monaco] monaco-editor not found in node_modules – skipping copy.")
  process.exit(0)
}

if (fs.existsSync(dest)) {
  console.log("[copy-monaco] public/monaco-vs already exists – skipping copy.")
  process.exit(0)
}

console.log("[copy-monaco] Copying monaco-editor/min/vs → public/monaco-vs …")
fs.mkdirSync(dest, { recursive: true })
fs.cpSync(src, dest, { recursive: true })
console.log("[copy-monaco] Done.")
